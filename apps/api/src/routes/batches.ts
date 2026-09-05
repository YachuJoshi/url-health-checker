import { clearCancellation, signalCancellation } from "@/cancellation";
import { pool } from "@/db";
import { publishBatchUpdate } from "@/publish";
import { getBatch, getChecks, listBatches } from "@/queries";
import { jobIdFor, urlCheckQueue } from "@/queue";
import { CreateBatchSchema } from "@/schema/batches.schema";
import { validateUrls } from "@/url-validation";
import {
  Batch,
  BatchDetail,
  type CreateBatchResponse,
} from "@url-checker/contracts";
import { Queue } from "bullmq";
import { FastifyInstance } from "fastify";

type AddBulkParams = Parameters<Queue["addBulk"]>[0];
type JobParam = AddBulkParams[number];

export async function batchRoutes(app: FastifyInstance) {
  app.get("/batches", async () => {
    return listBatches();
  });

  app.get<{ Params: { id: string } }>(
    "/batches/:id",
    async (request, reply) => {
      const batch = await getBatch(request.params.id);

      if (!batch) {
        return reply.status(404).send({ error: "Batch not found" });
      }

      const detail: BatchDetail = {
        batch,
        checks: await getChecks(request.params.id),
      };

      return detail;
    },
  );

  app.post("/batches", async (request, reply) => {
    const parsed = CreateBatchSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "Invalid request", details: parsed.error.issues });
    }

    const { valid, rejected } = validateUrls(parsed.data.urls);

    if (valid.length === 0) {
      return reply
        .status(400)
        .send({ error: "No valid URLs provided", rejected });
    }

    // Step 1: Persist the data in PostgreSQL using a transaction to ensure atomicity
    const client = await pool.connect();
    let batchId: string;
    let checks: { id: string; url: string }[] = [];

    try {
      await client.query("BEGIN");

      // 1. Insert a new batch record into the batches table and get the generated batch ID
      const batchResult = await client.query<{ id: string }>(
        "INSERT INTO batches (total_urls) VALUES ($1) RETURNING id",
        [valid.length],
      );

      batchId = batchResult.rows[0].id;

      // 2. Insert the valid URLs into the url_checks table, associating them with the new batch ID
      const checkResult = await client.query<{ id: string; url: string }>(
        `INSERT INTO url_checks (batch_id, url)
          SELECT $1, unnest($2::text[])
          RETURNING id, url`,
        [batchId, valid],
      );

      checks = checkResult.rows;

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Step 2: Enqueue the URLs only after the rows are durably committed
    const jobs: JobParam[] = checks.map((check) => ({
      name: "url-check",
      data: {
        checkId: check.id,
        batchId,
        url: check.url,
        runNumber: 1,
      },
      opts: {
        jobId: jobIdFor(check.id, 1),
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    }));

    await urlCheckQueue.addBulk(jobs);

    const response: CreateBatchResponse = {
      batchId,
      totalUrls: valid.length,
      rejected,
    };

    return reply.status(201).send(response);
  });

  app.post<{ Params: { id: string } }>(
    "/batches/:id/cancel",
    async (request, reply) => {
      const batchId = request.params.id;
      const client = await pool.connect();

      let cancelledRows: { id: string; runNumber: number }[];

      try {
        await client.query("BEGIN");

        const result = await client.query<Batch>(
          `SELECT status FROM batches WHERE id = $1 FOR UPDATE`,
          [batchId],
        );

        if (result.rows.length === 0) {
          await client.query("ROLLBACK");

          return reply.status(404).send({ error: "Batch not found" });
        }

        const [batch] = result.rows;

        if (batch.status === "completed" || batch.status === "cancelled") {
          await client.query("ROLLBACK");
          return reply
            .status(409)
            .send({ error: `Batch is already ${batch.status}` });
        }

        const cancelled = await client.query<{
          id: string;
          run_number: number;
        }>(
          `UPDATE url_checks
         SET status = 'cancelled', updated_at = now()
         WHERE batch_id = $1 AND status IN ('queued', 'running')
         RETURNING id, run_number`,
          [batchId],
        );

        cancelledRows = cancelled.rows.map((r) => ({
          id: r.id,
          runNumber: r.run_number,
        }));

        await client.query(
          `UPDATE batches SET status = 'cancelled', updated_at = now()
          WHERE id = $1`,
          [batchId],
        );

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      await signalCancellation(batchId);

      const jobIds = cancelledRows.map((check) =>
        jobIdFor(check.id, check.runNumber),
      );

      await Promise.allSettled(
        jobIds.map(async (jobId) => {
          const job = await urlCheckQueue.getJob(jobId);
          await job?.remove().catch(() => {}); // throws if the job is active (expected)
        }),
      );

      await publishBatchUpdate(batchId);

      return reply.status(200).send({ cancelled: cancelledRows.length });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/batches/:id/retry-failed",
    async (request, reply) => {
      const batchId = request.params.id;
      const client = await pool.connect();

      let retried: { id: string; url: string; run_number: number }[];

      try {
        await client.query("BEGIN");

        const batch = await client.query(
          `SELECT id FROM batches WHERE id = $1 FOR UPDATE`,
          [batchId],
        );

        if (batch.rows.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(404).send({ error: "Batch not found" });
        }

        const result = await client.query<{
          id: string;
          url: string;
          run_number: number;
        }>(
          `
          UPDATE url_checks 
          SET status = 'queued',
            run_number = run_number + 1,
            attempt_count = 0,
            error = NULL, http_status = NULL, response_ms = NULL, page_title = NULL,
            updated_at = now()
            WHERE batch_id = $1 AND status IN ('failed', 'cancelled')
            RETURNING id, url, run_number`,
          [batchId],
        );

        retried = result.rows;

        if (retried.length === 0) {
          await client.query("ROLLBACK");
          return reply
            .status(409)
            .send({ error: "No failed or cancelled URLs to retry" });
        }

        await client.query(
          `UPDATE batches SET status = 'running', updated_at = now() WHERE id = $1`,
          [batchId],
        );

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      // Prevent previous cancellation from abort new retries
      await clearCancellation(batchId);

      const jobsToAdd: JobParam[] = retried.map((check) => ({
        name: "check-url",
        data: {
          checkId: check.id,
          batchId,
          url: check.url,
          runNumber: check.run_number,
        },
        opts: {
          jobId: jobIdFor(check.id, check.run_number),
          attempts: 3,
          backoff: { type: "exponential", delay: 1000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      }));

      await urlCheckQueue.addBulk(jobsToAdd);

      await publishBatchUpdate(batchId);
      return reply.status(200).send({ retried: retried.length });
    },
  );
}
