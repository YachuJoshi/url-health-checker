import { redis } from "./redis";

function getBatchChannel(batchId: string) {
  return `batch:${batchId}`;
}

export async function publishCheckUpdate(
  batchId: string,
  checkId: string,
): Promise<void> {
  const payload = JSON.stringify({ type: "check", checkId });

  await redis.publish(getBatchChannel(batchId), payload);
}

export async function publishBatchUpdate(batchId: string): Promise<void> {
  const payload = JSON.stringify({ type: "batch" });

  await redis.publish(getBatchChannel(batchId), payload);
}
