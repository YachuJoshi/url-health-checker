import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "./env";

export const redis = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const urlCheckQueue = new Queue(env.URL_CHECK_QUEUE_NAME, {
  connection: redis,
});

/** Deterministic job ID — re-enqueueing the same run is a no-op, not a duplicate. */
export function jobIdFor(checkId: string, runNumber: number): string {
  return `${checkId}#${runNumber}`;
}
