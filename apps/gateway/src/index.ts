import { setTimeout as sleep } from "node:timers/promises";
import express from "express";
import { api } from "./api.js";
import { db, migrate } from "./db.js";
import { errorHandler } from "./http.js";
import { closeSessions, mcp } from "./mcp.js";
import { startHealthChecks } from "./upstreams.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req, res) => {
  res.send("ok");
});
app.get("/readyz", async (_req, res) => {
  await db.query("select 1");
  res.send("ok");
});
app.use("/api", api);
app.use(mcp);
app.use(errorHandler);

// Postgres may still be starting when the gateway boots
for (let attempt = 1; ; attempt++) {
  try {
    await migrate();
    break;
  } catch (err) {
    if (attempt === 30) throw err;
    console.log("Waiting for database...");
    await sleep(2000);
  }
}

await startHealthChecks();
const server = app.listen(8080, () => console.log("Gateway listening on :8080"));

// On rollout, finish in-flight requests before exiting. Open MCP streams are closed so clients reconnect.
process.on("SIGTERM", () => {
  console.log("Shutting down...");
  server.close(() => db.end().finally(() => process.exit(0)));
  closeSessions();
  setTimeout(() => process.exit(0), 10_000).unref();
});
