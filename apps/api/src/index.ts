import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./env";
import { batchRoutes } from "./routes/batches";
import { streamRoutes } from "./routes/stream";

const app = Fastify({ logger: true });

app.register(cors, { origin: true });

app.get("/health", async () => ({ status: "ok" }));

app.register(batchRoutes, { prefix: "/api" });
app.register(streamRoutes, { prefix: "/api" });

app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
