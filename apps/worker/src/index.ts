import { UrlCheckJobPayload } from "@url-checker/contracts";
import { Job, UnrecoverableError, Worker } from "bullmq";
import {
  markCheckAsRunning,
  persistCancelled,
  persistFailure,
  persistSuccess,
  refreshBatchStatus,
} from "./persist";
import { acquireSlot } from "./semaphore";
import { checkUrl } from "./check-url";
import { env } from "./env";
import { redis } from "./redis";
import { publishCheckUpdate, publishBatchUpdate } from "./publish";
import { cancellationWatcher, isCancelled } from "./cancellation";

const GLOBAL_CONCURRENCY = 5;
const GLOBAL_RATE_LIMIT = 10; // requests per second

async function processJob(job: Job<UrlCheckJobPayload>): Promise<void> {
  const { checkId, batchId, url, runNumber } = job.data;
  const attempt = job.attemptsMade + 1;
  const maxAttempts = job.opts.attempts ?? 1;

  console.log(
    `[Job ${job.id}] Start — url=${url} checkId=${checkId} attempt=${attempt}/${maxAttempts}`,
  );

  if (await isCancelled(batchId)) {
    console.log(`[Batch ${batchId}] - Cancelled`);

    await persistCancelled(checkId, runNumber);
    throw new UnrecoverableError("Batch cancelled");
  }

  const claimed = await markCheckAsRunning(checkId, runNumber);

  if (!claimed) {
    console.warn(
      `[Job ${job.id}] Skipped — checkId=${checkId} already claimed by another worker`,
    );

    throw new UnrecoverableError(
      `Check ${checkId} is already being processed by another worker.`,
    );
  }

  await refreshBatchStatus(batchId);

  const slot = await acquireSlot(GLOBAL_CONCURRENCY);

  const controller = new AbortController();
  const unregister = cancellationWatcher.register(batchId, controller);

  try {
    if (await isCancelled(batchId)) {
      await persistCancelled(checkId, runNumber);
      throw new UnrecoverableError("Batch cancelled");
    }

    const result = await checkUrl(url, controller.signal);

    if (result.type === "success") {
      console.log(
        `[Job ${job.id}] Success — status=${result.httpStatus} responseMs=${result.responseMs}ms title=${JSON.stringify(result.pageTitle)}`,
      );

      await persistSuccess(checkId, runNumber, result);
      await publishCheckUpdate(batchId, checkId);

      return;
    }

    if (controller.signal.aborted) {
      console.warn(`[Job ${job.id}] - Cancelled mid-flight`);

      await persistCancelled(checkId, runNumber);
      await publishCheckUpdate(batchId, checkId);

      throw new UnrecoverableError("Batch cancelled mid-flight");
    }

    if (!result.retryable) {
      console.warn(
        `[Job ${job.id}] Non-retryable failure — error=${result.error}`,
      );

      await persistFailure(checkId, runNumber, result.error);
      await publishCheckUpdate(batchId, checkId);

      throw new UnrecoverableError(result.error);
    }

    const isFinalAttempt = attempt >= maxAttempts;

    if (isFinalAttempt) {
      console.warn(
        `[Job ${job.id}] Final attempt failed — error=${result.error}`,
      );

      await persistFailure(checkId, runNumber, result.error);
      await publishCheckUpdate(batchId, checkId);
    } else {
      console.warn(
        `[Job ${job.id}] Retryable failure (attempt ${attempt}/${maxAttempts}) — error=${result.error}`,
      );
    }

    // Rethrow so BullMQ applies exponential backoff and retries
    throw new Error(result.error);
  } finally {
    unregister();
    await slot.release();
    await refreshBatchStatus(batchId);
    await publishBatchUpdate(batchId);
  }
}

const worker = new Worker<UrlCheckJobPayload>(
  env.URL_CHECK_QUEUE_NAME,
  processJob,
  {
    connection: redis,
    // Intentionally set above GLOBAL_CONCURRENCY so workers keep pulling jobs and queue on the
    // semaphore rather than idling. The semaphore is the real ceiling.
    concurrency: GLOBAL_CONCURRENCY * 2,
    limiter: {
      max: GLOBAL_RATE_LIMIT,
      duration: 1000,
    },
  },
);

worker.on("failed", (job, err) => {
  const attempts = job ? `${job.attemptsMade}/${job.opts.attempts ?? 1}` : "?";

  console.error(
    `[Job ${job?.id}] BullMQ failed after ${attempts} attempts: ${err.message}`,
  );
});

worker.on("ready", () => {
  console.log(
    `Worker Ready: Global Concurrency: ${GLOBAL_CONCURRENCY}, Rate Limit: ${GLOBAL_RATE_LIMIT} req/s`,
  );
});

async function shutdown() {
  await worker.close();
  await redis.quit();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
