import IORedis from "ioredis";
import { env } from "./env";

type Listener = (message: string) => void;

class BatchSubscriber {
  private redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  private listeners = new Map<string, Set<Listener>>();

  constructor() {
    this.redis.on("message", (channel, message) => {
      this.listeners.get(channel)?.forEach((listener) => listener(message));
    });
  }

  async subscribe(channel: string, listener: Listener) {
    let set = this.listeners.get(channel);

    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);

      await this.redis.subscribe(channel);
    }

    set.add(listener);

    return async () => {
      set.delete(listener);

      if (set.size === 0) {
        this.listeners.delete(channel);
        await this.redis.unsubscribe(channel);
      }
    };
  }
}

export const batchSubscriber = new BatchSubscriber();
