import { setTimeout as sleep } from "node:timers/promises";
import express from "express";
import { api } from "./api.js";
import { config } from "./config.js";
import { db, migrate } from "./db.js";
import { errorHandler } from "./http.js";
import { mcp } from "./mcp.js";
import { refresh } from "./upstreams.js";

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

await refresh();
setInterval(refresh, config.healthIntervalMs);
app.listen(8080, () => console.log("Gateway listening on :8080"));
