import { CACHE_KEYS } from "@url-checker/contracts";
import { redis } from "./redis";

export async function invalidateBatchList(): Promise<void> {
  await redis.incr(CACHE_KEYS.BATCH_LIST_VERSION_KEY);
}
