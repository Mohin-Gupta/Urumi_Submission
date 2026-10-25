import { EventEmitter } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.js";
import { decrypt } from "./crypto.js";
import { db } from "./db.js";
import { errorMessage } from "./http.js";

type ServerRow = {
  id: number;
  slug: string;
  name: string;
  url: string;
  header_name: string | null;
  header_value_enc: string | null;
  enabled: boolean;
};

type Upstream = {
  server: ServerRow;
  status: "connected" | "unreachable" | "disabled";
  tools: Tool[];
  client?: Client;
  error?: string;
  checkedAt: Date;
};

// Tool names exposed to clients are "<server slug>__<tool name>"
export const SEPARATOR = "__";
const MAX_DESCRIPTION = 1000;

const upstreams = new Map<number, Upstream>();
export const events = new EventEmitter();

async function connect(server: ServerRow) {
  const headers: Record<string, string> = {};
  if (server.header_name && server.header_value_enc) headers[server.header_name] = decrypt(server.header_value_enc);
  const client = new Client({ name: "urumi-gateway", version: "0.1.0" });
  // redirect: "error" stops an upstream from bouncing our credentialed request somewhere else
  const transport = new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers, redirect: "error" } });
  await client.connect(transport, { timeout: config.connectTimeoutMs });
  return client;
}

// Never throws: a failing server only marks itself unreachable
async function check(server: ServerRow): Promise<Upstream> {
  const previous = upstreams.get(server.id);
  const checkedAt = new Date();
  if (!server.enabled) {
    await previous?.client?.close();
    return { server, status: "disabled", tools: [], checkedAt };
  }
  try {
    const client = previous?.client ?? (await connect(server));
    const { tools } = await client.listTools(undefined, { timeout: config.connectTimeoutMs });
    return { server, client, status: "connected", tools, checkedAt };
  } catch (err) {
    await previous?.client?.close().catch(() => {});
    return { server, status: "unreachable", tools: [], error: errorMessage(err), checkedAt };
  }
}

const toolSignature = () => listTools().map((t) => t.name).sort().join();

async function refreshAll() {
  const before = toolSignature();
  const { rows } = await db.query<ServerRow>("select * from servers order by id");
  const results = await Promise.all(rows.map(check));
  for (const [id, upstream] of upstreams) {
    if (!rows.some((row) => row.id === id)) await upstream.client?.close();
  }
  upstreams.clear();
  for (const upstream of results) upstreams.set(upstream.server.id, upstream);
  if (toolSignature() !== before) events.emit("toolsChanged");
}

// Runs one at a time, so the timer and admin edits never race each other
let queue = Promise.resolve();
export function refresh() {
  queue = queue.then(refreshAll).catch((err) => console.error("refresh failed:", err));
  return queue;
}

// Drop the live connection so the next refresh reconnects with the new settings
export async function reload(serverId: number) {
  const upstream = upstreams.get(serverId);
  await upstream?.client?.close();
  if (upstream) upstream.client = undefined;
  await refresh();
}

export function listTools(): Tool[] {
  return [...upstreams.values()]
    .filter((u) => u.status === "connected")
    .flatMap((u) =>
      u.tools.map((tool) => ({
        ...tool,
        name: `${u.server.slug}${SEPARATOR}${tool.name}`,
        // Descriptions come from servers we don't control: label the source and cap the length
        description: `[${u.server.name}] ${(tool.description ?? "").slice(0, MAX_DESCRIPTION)}`,
      })),
    );
}

export function findUpstream(slug: string) {
  return [...upstreams.values()].find((u) => u.server.slug === slug);
}

// What the dashboard sees. Credentials never leave this module.
export function serverStatus() {
  return [...upstreams.values()].map(({ server, status, tools, error, checkedAt }) => ({
    id: server.id,
    slug: server.slug,
    name: server.name,
    url: server.url,
    enabled: server.enabled,
    authHeader: server.header_name,
    status,
    error,
    checkedAt,
    tools: tools.map((t) => ({ name: `${server.slug}${SEPARATOR}${t.name}`, description: t.description })),
  }));
}
