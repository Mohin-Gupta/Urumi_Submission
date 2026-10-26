import { randomUUID } from "node:crypto";
import { Router } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  isInitializeRequest,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.js";
import { sha256 } from "./crypto.js";
import { db, type User } from "./db.js";
import { errorMessage } from "./http.js";
import { takeToken } from "./rateLimit.js";
import { SEPARATOR, canUse, events, findUpstream, listTools, refresh } from "./upstreams.js";

const errorResult = (text: string): CallToolResult => ({ isError: true, content: [{ type: "text", text }] });

function splitToolName(name: string) {
  const at = name.indexOf(SEPARATOR);
  return at > 0 ? { slug: name.slice(0, at), tool: name.slice(at + SEPARATOR.length) } : { slug: null, tool: name };
}

async function audit(user: User, name: string, ms: number, error: string | null, source: string) {
  const { slug, tool } = splitToolName(name);
  await db.query(
    `insert into audit_log (user_id, user_email, server_slug, tool, duration_ms, ok, error, source)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [user.id, user.email, slug, tool, ms, error === null, error?.slice(0, 500) ?? null, source],
  );
}

export async function callTool(user: User, name: string, args: Record<string, unknown>, source: "mcp" | "chat") {
  const started = Date.now();
  const { slug, tool } = splitToolName(name);
  const upstream = slug ? findUpstream(slug) : undefined;
  // per user, so extra keys don't buy extra calls
  const waitSeconds = takeToken(`tools:${user.id}`, config.rateLimitPerMinute);
  let result: CallToolResult;

  if (waitSeconds) {
    result = errorResult(`Rate limit reached (${config.rateLimitPerMinute} tool calls a minute). Try again in ${waitSeconds}s.`);
  } else if (!upstream) {
    result = errorResult(`Unknown tool "${name}"`);
  } else if (!canUse(upstream.server, tool, user.role)) {
    result = errorResult(`Only admins can use "${name}"`);
  } else if (upstream.status !== "connected" || !upstream.client) {
    result = errorResult(`Server "${slug}" is ${upstream.status}${upstream.error ? `: ${upstream.error}` : ""}`);
  } else {
    try {
      result = (await upstream.client.callTool({ name: tool, arguments: args }, undefined, {
        timeout: config.callTimeoutMs,
      })) as CallToolResult;
    } catch (err) {
      const timedOut = err instanceof McpError && err.code === ErrorCode.RequestTimeout;
      result = errorResult(
        timedOut ? `Server "${slug}" timed out after ${config.callTimeoutMs / 1000}s` : `Server "${slug}" failed: ${errorMessage(err)}`,
      );
      // no retry: the call might have been a write that already went through
      if (!timedOut) refresh();
    }
  }

  const error = result.isError ? result.content.map((c) => (c.type === "text" ? c.text : "")).join(" ") || "Tool error" : null;
  await audit(user, name, Date.now() - started, error, source);
  return result;
}

// returns the owner of a revoked key too, so we can audit the attempt
async function authenticate(header?: string): Promise<{ user?: User; error?: string }> {
  const key = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!key) return { error: "Missing API key. Send it as: Authorization: Bearer <key>" };
  const { rows } = await db.query(
    `update api_keys k set last_used_at = case when k.revoked_at is null then now() else k.last_used_at end
     from users u
     where k.key_hash = $1 and u.id = k.user_id
     returning k.revoked_at, u.id, u.email, u.name, u.role`,
    [sha256(key)],
  );
  if (!rows[0]) return { error: "Invalid API key" };
  const { revoked_at, ...user } = rows[0];
  return revoked_at ? { user, error: "API key has been revoked" } : { user };
}

function createServer(user: User) {
  const server = new Server(
    { name: "urumi-gateway", version: "0.1.0" },
    { capabilities: { tools: { listChanged: true } } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listTools(user.role) }));
  server.setRequestHandler(CallToolRequestSchema, (req) =>
    callTool(user, req.params.name, req.params.arguments ?? {}, "mcp"),
  );
  return server;
}

type Session = { transport: StreamableHTTPServerTransport; server: Server; userId: number; lastSeen: number };
const sessions = new Map<string, Session>();
const SESSION_IDLE_MS = 30 * 60 * 1000;

events.on("toolsChanged", () => {
  for (const { server } of sessions.values()) server.sendToolListChanged().catch(() => {});
});

setInterval(() => {
  for (const session of sessions.values()) {
    if (Date.now() - session.lastSeen > SESSION_IDLE_MS) session.transport.close();
  }
}, 60_000).unref();

export const closeSessions = () => Promise.all([...sessions.values()].map((s) => s.transport.close()));

const rpcError = (message: string) => ({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });

export const mcp = Router();

mcp.all("/mcp", async (req, res) => {
  const { user, error } = await authenticate(req.headers.authorization);
  if (error || !user) {
    if (user && req.body?.method === "tools/call") await audit(user, String(req.body.params?.name ?? "unknown"), 0, error!, "mcp");
    return res.status(401).set("WWW-Authenticate", 'Bearer error="invalid_token"').json(rpcError(error!));
  }

  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let session = sessionId ? sessions.get(sessionId) : undefined;

  if (session && session.userId !== user.id) return res.status(403).json(rpcError("Session belongs to another user"));
  if (!session) {
    if (sessionId || !isInitializeRequest(req.body)) return res.status(404).json(rpcError("Session not found"));
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (id) => {
        sessions.set(id, newSession);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    const server = createServer(user);
    const newSession: Session = { transport, server, userId: user.id, lastSeen: Date.now() };
    await server.connect(transport);
    session = newSession;
  }

  session.lastSeen = Date.now();
  await session.transport.handleRequest(req, res, req.body);
});
