import { pool } from "@/db";
import { jobIdFor, urlCheckQueue } from "@/queue";
import { CreateBatchSchema } from "@/schema/batches.schema";
import { validateUrls } from "@/url-validation";
import { type CreateBatchResponse } from "@url-checker/contracts";
import { Queue } from "bullmq";
import { FastifyInstance } from "fastify";

type AddBulkParams = Parameters<Queue["addBulk"]>[0];
type JobParam = AddBulkParams[number];

export async function batchRoutes(app: FastifyInstance) {
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
}
