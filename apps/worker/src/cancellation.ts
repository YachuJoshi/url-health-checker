import IORedis from "ioredis";
import { redis } from "./redis";
import { env } from "./env";

export const CANCEL_CHANNEL = "batch-cancellations";

function cancelKey(batchId: string): string {
  return `cancelled:batch:${batchId}`;
}

export async function isCancelled(batchId: string): Promise<boolean> {
  const cancelKeyCount = await redis.exists(cancelKey(batchId));

  return cancelKeyCount === 1;
}

class CancellationWatcher {
  private inFlightControllerMap = new Map<string, Set<AbortController>>();
  private subscriber = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });

  async start(): Promise<void> {
    await this.subscriber.subscribe(CANCEL_CHANNEL);
    this.subscriber.on("message", (_channel, batchId) => {
      const controllers = this.inFlightControllerMap.get(batchId);

      if (!controllers) {
        return;
      }

      controllers.forEach((controller) => controller.abort());
    });
  }

  register(batchId: string, controller: AbortController) {
    let set = this.inFlightControllerMap.get(batchId);

    if (!set) {
      set = new Set();
      this.inFlightControllerMap.set(batchId, set);
    }

    set.add(controller);

    return () => {
      set.delete(controller);

      if (set.size === 0) {
        this.inFlightControllerMap.delete(batchId);
      }
    };
  }

  async stop() {
    await this.subscriber.quit();
  }
}

export const cancellationWatcher = new CancellationWatcher();
cancellationWatcher.start();
