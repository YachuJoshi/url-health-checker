import Fastify from "fastify";
import { env } from "./env";
import { batchRoutes } from "./routes/batches";

const app = Fastify({ logger: true });

app.get("/health", async () => ({ status: "ok" }));
app.register(batchRoutes, { prefix: "/api" });

app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
