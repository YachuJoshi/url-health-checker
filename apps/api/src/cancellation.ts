import { redis } from "./queue";

export const CANCEL_CHANNEL = "batch-cancellations";

const CANCEL_FLAG_TTL_SECONDS = 60 * 60;

function getCancelKey(batchId: string): string {
  return `cancelled:batch:${batchId}`;
}

export async function signalCancellation(batchId: string): Promise<void> {
  await redis.set(getCancelKey(batchId), "1", "EX", CANCEL_FLAG_TTL_SECONDS);
  await redis.publish(CANCEL_CHANNEL, batchId);
}

export async function clearCancellation(batchId: string): Promise<void> {
  await redis.del(getCancelKey(batchId));
}
