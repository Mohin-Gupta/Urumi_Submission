import { EventEmitter } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.js";
import { decrypt } from "./crypto.js";
import { db, type User } from "./db.js";
import { errorMessage } from "./http.js";
import { checkUpstreamUrl } from "./urlGuard.js";

type ServerRow = {
  id: number;
  slug: string;
  name: string;
  url: string;
  header_name: string | null;
  header_value_enc: string | null;
  enabled: boolean;
  admin_only_tools: string[];
};

type Role = User["role"];

type Upstream = {
  server: ServerRow;
  status: "connected" | "unreachable" | "disabled";
  tools: Tool[];
  client?: Client;
  error?: string;
  warning?: string;
  checkedAt: Date;
};

export const SEPARATOR = "__";
// what Claude and most clients accept; one bad name breaks the whole list
const VALID_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_DESCRIPTION = 1000;

const upstreams = new Map<number, Upstream>();
export const events = new EventEmitter();

const closeQuietly = (client?: Client) => client?.close().catch(() => {});

async function connect(server: ServerRow) {
  await checkUpstreamUrl(server.url);
  const headers: Record<string, string> = {};
  if (server.header_name && server.header_value_enc) headers[server.header_name] = decrypt(server.header_value_enc);
  const client = new Client({ name: "urumi-gateway", version: "0.1.0" });
  // never follow a redirect with our credentials attached
  const transport = new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers, redirect: "error" } });
  try {
    await client.connect(transport, { timeout: config.connectTimeoutMs });
    return client;
  } catch (err) {
    await closeQuietly(client);
    throw err;
  }
}

async function fetchTools(client: Client) {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: config.connectTimeoutMs });
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

function connected(server: ServerRow, client: Client, tools: Tool[], checkedAt: Date): Upstream {
  const usable = tools.filter((t) => VALID_TOOL_NAME.test(`${server.slug}${SEPARATOR}${t.name}`));
  const hidden = tools.length - usable.length;
  const warning = hidden
    ? `${hidden} tool(s) hidden: names must use only letters, digits, _ or - and fit in 64 characters with the prefix`
    : undefined;
  return { server, client, status: "connected", tools: usable, warning, checkedAt };
}

async function check(server: ServerRow): Promise<Upstream> {
  const previous = upstreams.get(server.id);
  const checkedAt = new Date();
  if (!server.enabled) {
    await closeQuietly(previous?.client);
    return { server, status: "disabled", tools: [], checkedAt };
  }
  if (previous?.client) {
    try {
      return connected(server, previous.client, await fetchTools(previous.client), checkedAt);
    } catch {
      await closeQuietly(previous.client);
    }
  }
  let client: Client | undefined;
  try {
    client = await connect(server);
    return connected(server, client, await fetchTools(client), checkedAt);
  } catch (err) {
    await closeQuietly(client);
    return { server, status: "unreachable", tools: [], error: errorMessage(err).slice(0, 300), checkedAt };
  }
}

const toolSignature = () =>
  listTools("admin")
    .map((t) => `${t.name}:${listTools("member").some((m) => m.name === t.name)}`)
    .sort()
    .join();

async function refreshAll() {
  const before = toolSignature();
  const { rows } = await db.query<ServerRow>("select * from servers order by id");
  const results = await Promise.all(rows.map(check));
  for (const [id, upstream] of upstreams) {
    if (!rows.some((row) => row.id === id)) await closeQuietly(upstream.client);
  }
  upstreams.clear();
  for (const upstream of results) upstreams.set(upstream.server.id, upstream);
  if (toolSignature() !== before) events.emit("toolsChanged");
}

let queue = Promise.resolve();
export function refresh() {
  queue = queue.then(refreshAll).catch((err) => console.error("refresh failed:", err));
  return queue;
}

export function startHealthChecks() {
  const loop = () => refresh().then(() => setTimeout(loop, config.healthIntervalMs));
  return loop();
}

export async function reload(serverId: number) {
  const upstream = upstreams.get(serverId);
  await closeQuietly(upstream?.client);
  if (upstream) upstream.client = undefined;
  await refresh();
}

export const canUse = (server: ServerRow, tool: string, role: Role) =>
  role === "admin" || !server.admin_only_tools.includes(tool);

export function listTools(role: Role): Tool[] {
  return [...upstreams.values()]
    .filter((u) => u.status === "connected")
    .flatMap((u) =>
      u.tools.filter((tool) => canUse(u.server, tool.name, role)).map((tool) => ({
        ...tool,
        name: `${u.server.slug}${SEPARATOR}${tool.name}`,
        // untrusted text: label where it came from and cap it
        description: `[${u.server.name}] ${(tool.description ?? "").slice(0, MAX_DESCRIPTION)}`,
      })),
    );
}

export function findUpstream(slug: string) {
  return [...upstreams.values()].find((u) => u.server.slug === slug);
}

export function serverStatus(role: Role) {
  return [...upstreams.values()].map(({ server, status, tools, error, warning, checkedAt }) => ({
    id: server.id,
    slug: server.slug,
    name: server.name,
    url: server.url,
    enabled: server.enabled,
    authHeader: server.header_name,
    status,
    error,
    warning,
    checkedAt,
    tools: tools
      .filter((t) => canUse(server, t.name, role))
      .map((t) => ({
        name: `${server.slug}${SEPARATOR}${t.name}`,
        tool: t.name,
        description: t.description,
        adminOnly: server.admin_only_tools.includes(t.name),
      })),
  }));
}
