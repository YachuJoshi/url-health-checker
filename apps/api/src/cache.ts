import { CACHE_KEYS } from "@url-checker/contracts";
import { redis } from "./queue";

const TTL_SECONDS = 30;

/**
 * Version-stamped cache key
 */
function constructListKey(version: string): string {
  return `cache:batches:list:v${version}`;
}

async function getCurrentVersion(): Promise<string> {
  return (await redis.get(CACHE_KEYS.BATCH_LIST_VERSION_KEY)) ?? "0";
}

export async function getBatchList<T>(): Promise<T | null> {
  const currentVersion = await getCurrentVersion();
  const cached = await redis.get(constructListKey(currentVersion));

  return cached ? (JSON.parse(cached) as T) : null;
}

export async function setBatchList<T>(value: T): Promise<void> {
  const currentVersion = await getCurrentVersion();
  const listKey = constructListKey(currentVersion);

  await redis.set(listKey, JSON.stringify(value), "EX", TTL_SECONDS);
}

/**
 * Called on batch lifecycle transitions only: Creation, cancellation and completion.
 */
export async function invalidateBatchList(): Promise<void> {
  await redis.incr(CACHE_KEYS.BATCH_LIST_VERSION_KEY);
}
