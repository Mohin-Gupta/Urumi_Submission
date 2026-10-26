export type User = { id: number; email: string; name: string; role: "admin" | "member" };
export type TeamMember = User & { invited: boolean; created_at: string };
export type Tool = { name: string; tool: string; description?: string; adminOnly: boolean };
export type Stat = {
  server_slug: string | null;
  tool?: string;
  calls: number;
  failed: number;
  p50_ms: number;
  p95_ms: number;
  last_call: string;
};
export type Server = {
  id: number;
  slug: string;
  name: string;
  url: string;
  enabled: boolean;
  authHeader: string | null;
  status: "connected" | "unreachable" | "disabled";
  error?: string;
  warning?: string;
  checkedAt: string;
  tools: Tool[];
};
export type ApiKey = {
  id: number;
  name: string;
  prefix: string;
  user_email: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};
export type AuditRow = {
  id: number;
  at: string;
  user_email: string;
  server_slug: string | null;
  tool: string;
  duration_ms: number;
  ok: boolean;
  error: string | null;
  source: "mcp" | "chat";
};

export type ChatTurn = { role: "user" | "assistant"; content: string };
export type ToolStep = { tool: string; args: unknown; ok: boolean; output: string };

export async function api<T = void>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const { body, method = body ? "POST" : "GET" } = options;
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  // An expired session anywhere sends the app back to the login screen
  if (res.status === 401 && path !== "/login") window.dispatchEvent(new Event("signed-out"));
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Request failed (${res.status})`);
  return res.status === 204 ? (undefined as T) : res.json();
}
