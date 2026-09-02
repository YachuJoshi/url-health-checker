import { randomUUID } from "crypto";
import { redis } from "./redis";

const SEMAPHORE_KEY = "semaphore:url-checks";

/**
 * Slot TTL must exceed the longest possible check (HTTP timeout + overhead).
 * If a worker dies mid-check, its slot self-evicts after this window rather
 * than permanently reducing global capacity.
 */
const SLOT_TTL_MS = 30_000;

const ACQUIRE_SCRIPT = `
  local key = KEYS[1]
  local now = tonumber(ARGV[1])
  local limit = tonumber(ARGV[2])
  local slot = ARGV[3]
  local ttl = tonumber(ARGV[4])

  redis.call('ZREMRANGEBYSCORE', key, '-inf', now)

  if redis.call('ZCARD', key) < limit then
    redis.call('ZADD', key, now + ttl, slot)
    return 1
  end

  return 0
`;

export interface SemaphoreSlot {
  release: () => Promise<void>;
}

/**
 * Blocks until a global concurrency slot is available.
 * Polls rather than using pub/sub — with a max wait of one in-flight check,
 * a 100ms poll is simpler and the contention is low.
 */
export async function acquireSlot(limit: number): Promise<SemaphoreSlot> {
  const slotId = randomUUID();

  while (true) {
    const acquired = await redis.eval(
      ACQUIRE_SCRIPT,
      1,
      SEMAPHORE_KEY,
      Date.now().toString(),
      limit.toString(),
      slotId,
      SLOT_TTL_MS.toString(),
    );

    if (acquired === 1) {
      return {
        release: async () => {
          await redis.zrem(SEMAPHORE_KEY, slotId);
        },
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
