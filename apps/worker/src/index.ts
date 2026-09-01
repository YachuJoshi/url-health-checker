import { env } from "./env";

console.log("worker process started — job processing lands here later");
console.log(
  `Configured DB and Redis connections (${Object.keys(env).length} vars loaded)`,
);
