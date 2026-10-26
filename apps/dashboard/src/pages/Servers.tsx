import { useState } from "react";
import { api, type Server, type User } from "../api";
import { CodeLine, ErrorText, PageHeader, timeAgo, useData, useSubmit } from "../ui";

const STATUS_LABEL = { connected: "Connected", unreachable: "Unreachable", disabled: "Disabled" };

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
    <form className="panel server-form" onSubmit={onSubmit}>
      <h2>{server ? `Edit ${server.name}` : "Add a server"}</h2>
      <div className="grid-2">
        <label>
          Name
          <input name="name" defaultValue={server?.name} required />
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

function ServerRow({ server, isAdmin, onChange }: { server: Server; isAdmin: boolean; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string>();

  const act = (fn: () => Promise<unknown>) => () => fn().then(onChange, (e: Error) => setError(e.message));
  const toggle = act(() => api(`/servers/${server.id}`, { method: "PATCH", body: { enabled: !server.enabled } }));
  const remove = act(async () => {
    if (confirm(`Remove ${server.name}? Its tools disappear for everyone.`)) await api(`/servers/${server.id}`, { method: "DELETE" });
  });
  const setAdminOnly = (tool: string, adminOnly: boolean) => {
    const current = server.tools.filter((t) => t.adminOnly).map((t) => t.tool);
    const next = adminOnly ? [...current, tool] : current.filter((t) => t !== tool);
    act(() => api(`/servers/${server.id}`, { method: "PATCH", body: { adminOnlyTools: next } }))();
  };

  if (editing) {
    return <ServerForm server={server} onSaved={() => (setEditing(false), onChange())} onCancel={() => setEditing(false)} />;
  }

  return (
    <li className={`line line-${server.status}`}>
      <div className="line-main">
        <span className="lamp" aria-hidden />
        <div className="line-id">
          <h2>{server.name}</h2>
          <code>{server.url}</code>
        </div>
        <div className="line-status">
          <strong>{STATUS_LABEL[server.status]}</strong>
          <span className="muted">Checked {timeAgo(server.checkedAt)}</span>
        </div>
        <button type="button" className="ghost small" onClick={() => setOpen(!open)} aria-expanded={open} disabled={!server.tools.length}>
          {server.tools.length} {server.tools.length === 1 ? "tool" : "tools"}
        </button>
      </div>
      {(server.error || server.warning) && <p className="line-error">{server.error ?? server.warning}</p>}
      {open && (
        <ul className={isAdmin ? "tools tools-admin" : "tools"}>
          {server.tools.map((t) => (
            <li key={t.name}>
              <code>{t.name}</code>
              <span>{t.description}</span>
              {isAdmin && (
                <label className="check">
                  <input type="checkbox" checked={t.adminOnly} onChange={(e) => setAdminOnly(t.tool, e.target.checked)} />
                  Admins only
                </label>
              )}
            </li>
          ))}
        </ul>
      )}
      {isAdmin && (
        <div className="line-actions">
          <button type="button" className="ghost small" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button type="button" className="ghost small" onClick={toggle}>
            {server.enabled ? "Disable" : "Enable"}
          </button>
          <button type="button" className="ghost small danger" onClick={remove}>
            Remove
          </button>
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </li>
  );
}

export function Servers({ user }: { user: User }) {
  const { data: servers, error, reload } = useData<Server[]>("/servers", 5000);
  const [adding, setAdding] = useState(false);
  const isAdmin = user.role === "admin";
  const toolCount = servers?.reduce((n, s) => n + s.tools.length, 0) ?? 0;

  return (
    <>
      <PageHeader title="Servers">
        Every connected server's tools are available to your team through one endpoint. {toolCount} tools are live right now.
      </PageHeader>

      <section className="panel endpoint">
        <h2>Your gateway endpoint</h2>
        <CodeLine text={`${window.location.origin}/mcp`} />
        <p className="muted">Add it to Claude Code, Cursor or any MCP client with an API key from the API keys page.</p>
      </section>

      {isAdmin && !adding && (
        <button className="add" onClick={() => setAdding(true)}>
          Add server
        </button>
      )}
      {adding && <ServerForm onSaved={() => (setAdding(false), reload())} onCancel={() => setAdding(false)} />}

      <ErrorText>{error}</ErrorText>
      <ul className="lines">
        {servers?.map((s) => <ServerRow key={s.id} server={s} isAdmin={isAdmin} onChange={reload} />)}
      </ul>
      {servers?.length === 0 && <p className="empty">No servers yet. Add one to give your team its first tools.</p>}
    </>
  );
}
