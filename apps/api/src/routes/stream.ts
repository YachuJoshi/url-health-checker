import { getBatchChannel } from "@/channels";
import { getBatch, getBatchProgress, getCheck } from "@/queries";
import { batchSubscriber } from "@/sse";
import type { BatchEvent } from "@url-checker/contracts";
import type { FastifyInstance } from "fastify";

const HEARTBEAT_MS = 25_000;

export async function streamRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>(
    "/batches/:id/stream",
    async (request, reply) => {
      const batchId = request.params.id;
      const batch = await getBatch(batchId);

      if (!batch) {
        return reply.status(404).send({ error: "Batch not found" });
      }

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // disable nginx response buffering
      });

      const send = (event: BatchEvent) => {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      const unsubscribe = await batchSubscriber.subscribe(
        getBatchChannel(batchId),
        async (raw) => {
          try {
            const message = JSON.parse(raw) as {
              type: string;
              checkId?: string;
            };

            if (message.type === "check" && message.checkId) {
              const [check, progress] = await Promise.all([
                getCheck(message.checkId),
                getBatchProgress(batchId),
              ]);

              if (check) {
                send({ type: "check-updated", check, progress });
              }

              return;
            }

            const current = await getBatch(batchId);

            if (current) {
              send({
                type: "batch-updated",
                status: current.status,
                progress: current.progress,
              });
            }
          } catch (err) {
            request.log.error(err, "Failed to deliver SSE event.");
          }
        },
      );

      const heartbeat = setInterval(
        () => reply.raw.write(`: ping\n\n`),
        HEARTBEAT_MS,
      );

      request.raw.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    },
  );
}
