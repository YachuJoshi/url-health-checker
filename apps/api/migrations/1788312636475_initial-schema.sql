-- Up Migration

CREATE TYPE batch_status AS ENUM ('pending', 'running', 'completed', 'cancelled');
CREATE TYPE check_status AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');

CREATE TABLE batches (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status       batch_status NOT NULL DEFAULT 'pending',
  total_urls   INTEGER NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE url_checks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id       UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  url            TEXT NOT NULL,
  status         check_status NOT NULL DEFAULT 'queued',

  -- Result columns: all NULL until a check produces an answer.
  http_status    INTEGER,
  response_ms    INTEGER,
  page_title     TEXT,
  error          TEXT,

  -- Retry + idempotency bookkeeping.
  attempt_count  INTEGER NOT NULL DEFAULT 0,
  run_number     INTEGER NOT NULL DEFAULT 1,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Batch detail page: fetch all checks for one batch, stable ordering.
CREATE INDEX idx_url_checks_batch_id ON url_checks (batch_id, created_at);

-- Progress counts per batch, and the "retry failed only" lookup.
CREATE INDEX idx_url_checks_batch_status ON url_checks (batch_id, status);

-- Batch list page: newest first.
CREATE INDEX idx_batches_created_at ON batches (created_at DESC);

-- Down Migration

DROP TABLE url_checks;
DROP TABLE batches;
DROP TYPE check_status;
DROP TYPE batch_status;