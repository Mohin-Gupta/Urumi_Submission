import { Fragment, useState } from "react";
import { api, type Server, type Stat, type User } from "../api";
import { Icon } from "../icons";
import { CopyButton, ErrorText, PageHeader, timeAgo, useData, useSubmit } from "../ui";

const STATUS_LABEL = { connected: "Connected", unreachable: "Unreachable", disabled: "Disabled" };
const FILTERS = ["all", "connected", "unreachable", "disabled"] as const;
type Filter = (typeof FILTERS)[number];

function authBody(f: Record<string, string>) {
  if (f.authType === "keep") return undefined;
  if (f.authType === "bearer") return { type: "bearer", token: f.token };
  if (f.authType === "header") return { type: "header", name: f.headerName, value: f.headerValue };
  return { type: "none" };
}

// Used for both adding and editing. Stored credentials are never sent back, so editing offers "keep".
function ServerForm({ server, onSaved, onCancel }: { server?: Server; onSaved: () => void; onCancel: () => void }) {
  const [authType, setAuthType] = useState(server ? "keep" : "none");
  const { onSubmit, error, busy } = useSubmit(async (f) => {
    const body = { slug: f.slug, name: f.name, url: f.url, auth: authBody(f) };
    await api(server ? `/servers/${server.id}` : "/servers", { method: server ? "PATCH" : "POST", body });
    onSaved();
  });

  return (
    <form className="panel" onSubmit={onSubmit}>
      <h2>{server ? `Edit ${server.name}` : "Add a server"}</h2>
      <div className="grid-2">
        <label>
          Name
          <input name="name" defaultValue={server?.name} required autoFocus />
        </label>
        <label>
          Tool prefix
          <input name="slug" defaultValue={server?.slug} pattern="[a-z0-9-]{1,20}" required />
          <small>Tools appear as prefix__tool_name</small>
        </label>
      </div>
      <label>
        MCP endpoint URL
        <input name="url" type="url" defaultValue={server?.url} placeholder="https://example.com/mcp" required />
      </label>
      <label>
        Credential
        <select name="authType" value={authType} onChange={(e) => setAuthType(e.target.value)}>
          {server && <option value="keep">Keep current ({server.authHeader ? `${server.authHeader} header` : "none"})</option>}
          <option value="none">None</option>
          <option value="bearer">Bearer token</option>
          <option value="header">Custom header</option>
        </select>
      </label>
      {authType === "bearer" && (
        <label>
          Token
          <input name="token" type="password" autoComplete="off" required />
        </label>
      )}
      {authType === "header" && (
        <div className="grid-2">
          <label>
            Header name
            <input name="headerName" placeholder="X-API-Key" required />
          </label>
          <label>
            Header value
            <input name="headerValue" type="password" autoComplete="off" required />
          </label>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="actions">
        <button disabled={busy}>{server ? "Save changes" : "Add server"}</button>
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ServerRows({ server, stat, isAdmin, open, onToggle, onEdit, onChange }: {
  server: Server;
  stat?: Stat;
  isAdmin: boolean;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onChange: () => void;
}) {
  const [error, setError] = useState<string>();
  const act = (fn: () => Promise<unknown>) => fn().then(onChange, (e: Error) => setError(e.message));
  const toggleEnabled = () => act(() => api(`/servers/${server.id}`, { method: "PATCH", body: { enabled: !server.enabled } }));
  const remove = () => {
    if (confirm(`Remove ${server.name}? Its tools disappear for everyone.`)) act(() => api(`/servers/${server.id}`, { method: "DELETE" }));
  };
  const setAdminOnly = (tool: string, adminOnly: boolean) =>
    act(() => api(`/servers/${server.id}/tools/${encodeURIComponent(tool)}`, { method: "PUT", body: { adminOnly } }));

  return (
    <>
      <tr className="expand" aria-expanded={open} onClick={onToggle}>
        <td>
          <span className={`status status-${server.status}`}>
            <span className="dot" />
            {STATUS_LABEL[server.status]}
          </span>
        </td>
        <td className="server-name">
          <b>{server.name}</b>
          <code>{server.slug}</code>
          {(server.error || server.warning) && <div className="reason">{server.error ?? server.warning}</div>}
        </td>
        <td className="url">{server.url}</td>
        <td className="num">{server.tools.length}</td>
        {isAdmin && <td className="num">{stat?.calls ?? 0}</td>}
        {isAdmin && <td className="num">{stat ? `${stat.p95_ms} ms` : "—"}</td>}
        <td className="num">{timeAgo(server.checkedAt)}</td>
        <td>
          <button className="ghost small" aria-label={open ? "Hide tools" : "Show tools"} onClick={(e) => (e.stopPropagation(), onToggle())}>
            <span className="chevron">
              <Icon name="chevron" />
            </span>
          </button>
        </td>
      </tr>
      {open && (
        <tr className="detail-row">
          <td colSpan={isAdmin ? 8 : 6}>
            {server.tools.length > 0 ? (
              <div className="tool-list">
                {server.tools.map((t) => (
                  <div className="tool" key={t.name}>
                    <code>{t.name}</code>
                    <p>{t.description}</p>
                    {isAdmin ? (
                      <label className="switch">
                        <input type="checkbox" checked={t.adminOnly} onChange={(e) => setAdminOnly(t.tool, e.target.checked)} />
                        Admins only
                      </label>
                    ) : (
                      <span />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No tools while the server is {server.status}.</p>
            )}
            {isAdmin && (
              <div className="detail-actions">
                <span className="muted">{server.authHeader ? `Sends a ${server.authHeader} header` : "No credential"}</span>
                <button className="ghost small" onClick={onEdit}>
                  Edit
                </button>
                <button className="ghost small" onClick={toggleEnabled}>
                  {server.enabled ? "Disable" : "Enable"}
                </button>
                <button className="ghost small danger" onClick={remove}>
                  Remove
                </button>
              </div>
            )}
            <ErrorText>{error}</ErrorText>
          </td>
        </tr>
      )}
    </>
  );
}

export function Servers({ user }: { user: User }) {
  const isAdmin = user.role === "admin";
  const { data: servers, error, reload } = useData<Server[]>("/servers", 5000);
  const { data: metrics } = useData<{ servers: Stat[] }>(isAdmin ? "/metrics" : null, 15000);
  const [form, setForm] = useState<"add" | number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const endpoint = `${window.location.origin}/mcp`;
  const all = servers ?? [];
  const count = (f: Filter) => (f === "all" ? all.length : all.filter((s) => s.status === f).length);
  const shown = all.filter(
    (s) => (filter === "all" || s.status === filter) && `${s.name} ${s.slug} ${s.url}`.toLowerCase().includes(query.toLowerCase()),
  );
  const statFor = (slug: string) => metrics?.servers.find((m) => m.server_slug === slug);
  const totals = metrics?.servers.reduce((t, m) => ({ calls: t.calls + m.calls, failed: t.failed + m.failed }), { calls: 0, failed: 0 });
  const editing = typeof form === "number" ? all.find((s) => s.id === form) : undefined;
  const saved = () => (setForm(null), reload());

  return (
    <>
      <PageHeader
        title="Servers"
        actions={
          <>
            <span className="endpoint">
              {endpoint.replace(/^https?:\/\//, "")}
              <CopyButton text={endpoint} />
            </span>
            {isAdmin && form === null && <button onClick={() => setForm("add")}>Add server</button>}
          </>
        }
      />

      <div className="stats">
        <div className="stat">
          <small>Tools live</small>
          <div>{all.reduce((n, s) => n + s.tools.length, 0)}</div>
        </div>
        <div className="stat">
          <small>Servers connected</small>
          <div>
            {count("connected")}
            <span>of {all.length}</span>
          </div>
        </div>
        {isAdmin && (
          <>
            <div className="stat">
              <small>Calls, 24 h</small>
              <div>{totals?.calls ?? "—"}</div>
            </div>
            <div className="stat">
              <small>Error rate, 24 h</small>
              <div>{totals?.calls ? `${((totals.failed / totals.calls) * 100).toFixed(1)}%` : "—"}</div>
            </div>
          </>
        )}
      </div>

      {form === "add" && <ServerForm onSaved={saved} onCancel={() => setForm(null)} />}
      {editing && <ServerForm server={editing} onSaved={saved} onCancel={() => setForm(null)} />}

      <div className="toolbar">
        <div className="segmented">
          {FILTERS.map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : STATUS_LABEL[f]} {count(f)}
            </button>
          ))}
        </div>
        <input type="search" placeholder="Filter servers…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter servers" />
      </div>

      <ErrorText>{error}</ErrorText>
      {shown.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 150 }}>Status</th>
                <th>Server</th>
                <th>Endpoint</th>
                <th className="num">Tools</th>
                {isAdmin && <th className="num">Calls 24 h</th>}
                {isAdmin && <th className="num">p95</th>}
                <th className="num">Checked</th>
                <th style={{ width: 48 }} />
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <Fragment key={s.id}>
                  <ServerRows
                    server={s}
                    stat={statFor(s.slug)}
                    isAdmin={isAdmin}
                    open={open === s.id}
                    onToggle={() => setOpen(open === s.id ? null : s.id)}
                    onEdit={() => setForm(s.id)}
                    onChange={reload}
                  />
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {servers && all.length === 0 && <p className="empty">No servers yet. Add one to give your team its first tools.</p>}
      {servers && all.length > 0 && shown.length === 0 && <p className="empty">No servers match this filter.</p>}
    </>
  );
}
