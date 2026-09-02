# Bulk URL Health Checker

Submit a list of URLs, check them in the background, watch results arrive live.

## Status

Built so far:

- [x] Monorepo scaffold (API, worker, web, shared types)
- [x] PostgreSQL schema + migrations
- [x] Batch submission (paste or CSV) with validation and persistence
- [x] Job enqueueing to BullMQ
- [ ] Worker processing (rate limit, concurrency, retries)
- [ ] Live updates (SSE)
- [ ] UI (batch list + batch detail)
- [ ] Cancel / retry-failed controls
- [ ] Batch list caching

## Running the system

> A single-command setup is not yet in place — the API, worker, and web app
> currently run on the host while Postgres and Redis run in containers. This
> will be consolidated before delivery.

```bash
pnpm install
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
cp apps/web/.env.example apps/web/.env.local

pnpm run docker:up                        # Postgres + Redis
pnpm --filter @url-checker/api migrate:up # apply schema
pnpm --filter @url-checker/shared-types build
pnpm run dev                              # api + worker + web
```

- API: `http://localhost:4000`
- Web: `http://localhost:3000`

## Architecture

![Architecture](docs/architecture.png)

Four process types, deliberately separated:

| Process              | Responsibility                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------- |
| **Next.js web**      | UI. Server components fetch initial state; client components hold the live connection.   |
| **Fastify API**      | HTTP surface. Reads state from Postgres, enqueues jobs to Redis. Horizontally scalable.  |
| **Worker**           | Pulls jobs, performs HTTP checks, writes results. No HTTP server. Horizontally scalable. |
| **Postgres / Redis** | Source of truth / scheduling and coordination.                                           |

### Where state lives

**PostgreSQL is the single source of truth.** Every piece of batch and job state
the user can observe lives there. The API reads state exclusively from Postgres;
workers write results exclusively to Postgres.

**Redis holds nothing that cannot be rebuilt.** It is scheduling and coordination
infrastructure: the BullMQ queue, the global rate limiter, the concurrency
semaphore, pub/sub fanout for live updates, and the batch-list cache. If Redis
were flushed, no user-visible truth would be lost — only in-flight scheduling.

This split is what makes cancel, retry-failed-only, and idempotency tractable.

## Design decisions

### Batch status is stored; progress counts are derived

`batches.status` holds a lifecycle state (`pending` / `running` / `completed` /
`cancelled`). Per-status counts are computed from `url_checks` on read.

Cancellation is an instruction, not a summary — a cancelled batch and a finished
batch can have identical child rows, so the batch-level fact needs its own home.
Everything that _can_ be derived is derived, so it cannot drift.

### `succeeded` means "we got an answer", not "the site was healthy"

A 404 is a **successful check** that recorded status 404. Only genuine transport
failures (timeout, DNS failure, connection reset) mark a check `failed`.

If `succeeded` meant 2xx, "retry failed only" would re-check every 404 forever —
they could never leave the failed state. This is also why `http_status` and
`error` are separate columns: a failed row has no HTTP status at all, because no
response ever arrived.

### Persist first, enqueue second

Batch and URL rows are committed to Postgres **before** any job is enqueued.

Enqueueing inside the transaction would be a correctness bug: Redis has no
knowledge of Postgres transaction boundaries, so a worker could pick up a job and
query for a row that is not yet visible — or that a rollback means will never
exist.

**Known gap:** if the API crashes between `COMMIT` and `addBulk`, rows sit in
`queued` with no jobs behind them. Mitigated by deterministic job IDs, which make
re-enqueueing safe. See Trade-offs.

### Two independent retry counters

| Column          | Meaning                                                               |
| --------------- | --------------------------------------------------------------------- |
| `attempt_count` | Automatic retries within one run (BullMQ, exponential backoff, max 3) |
| `run_number`    | User-initiated re-runs via "retry failed only"                        |

A URL can be on run 2, attempt 1. Conflating them would lose the ability to
answer "did this URL need retries?" after a manual retry.

### `run_number` is the idempotency guard

Every worker write is conditional on the run it belongs to:

```sql
UPDATE url_checks
SET status = 'succeeded', http_status = $1, ...
WHERE id = $2 AND run_number = $3;
```

Scenario: a check fails, the user clicks retry, the row moves to run 2. The
_original_ worker is still in flight and about to write a stale result. Its write
matches zero rows and is silently discarded.

The same column produces deterministic BullMQ job IDs — `${checkId}:${runNumber}`
— so enqueueing the same run twice yields one job, not two.

## Assumptions

Recorded rather than asked, per the brief:

1. **Duplicate URLs within a batch are permitted.** Pasting the same URL twice is
   plausible user input, not an error. Deduplicating would silently change
   `total_urls` from what the user submitted. No unique constraint on
   `(batch_id, url)`.

2. **Partial acceptance on validation.** If 100 URLs are submitted and 3 are
   malformed, the 97 valid ones proceed and the rejected ones are returned in the
   response with reasons. Rejecting the whole batch was judged hostile.

3. **CSV parsing is client-side.** A CSV of URLs is a presentation concern — the
   browser reads the file and posts the same `{ urls: string[] }` payload as the
   paste box. This avoids a second server-side parser and failure path. For large
   or structurally complex files, server-side parsing would win.

4. **Only `http` and `https` are accepted.** Also a security boundary: without it,
   `file:///etc/passwd` would be fetched by the worker. See Known limitations.

5. **500 URLs per batch maximum.** Arbitrary but finite; enforced on both sides
   from a single shared constant.

## Known limitations

- **SSRF is only partially mitigated.** Protocol is restricted to http/https, but
  private IP ranges (`10.0.0.0/8`, `127.0.0.0/8`, `169.254.169.254`) are not
  blocked. A production system must reject these after DNS resolution.
- **No authentication.** Explicitly out of scope.
- **The commit/enqueue gap** described above is documented, not closed.

## Trade-offs

**Commit-then-enqueue instead of a transactional outbox.**
An outbox table plus a relay process would close the crash window entirely. Given
the time budget, deterministic job IDs plus Postgres-as-truth make the gap
recoverable rather than fatal. _With more time:_ outbox pattern.

**Raw SQL over an ORM.**
The idempotency story here _is_ the conditional `UPDATE ... WHERE run_number = $n`.
An ORM would abstract away exactly the mechanism worth showing. `node-pg-migrate`
keeps DDL as the source of truth with no schema-drift ambiguity.

**pnpm workspaces over Turborepo.**
Build caching is irrelevant at this size. One less tool to justify.

## Type safety

`packages/shared-types` is imported by both the API and the web app, so status
enums, entity shapes, and request/response contracts have exactly one definition.

Types alone vanish at runtime, so request bodies are validated with Zod at the API
edge — the boundary is enforced, not merely declared.

## Database schema

| Table        | Purpose                                                    |
| ------------ | ---------------------------------------------------------- |
| `batches`    | Lifecycle state, `total_urls`, timestamps                  |
| `url_checks` | One row per URL: status, result columns, retry bookkeeping |

Indexes support the three real access patterns: batch detail (`batch_id, created_at`),
progress counts and retry-failed lookup (`batch_id, status`), and the batch list
(`created_at DESC`).
