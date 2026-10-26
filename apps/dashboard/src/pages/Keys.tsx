import { useState } from "react";
import { api, type ApiKey, type User } from "../api";
import { CodeLine, ErrorText, PageHeader, Reveal, claudeCommand, formatTime, timeAgo, useData, useSubmit } from "../ui";

export function NewKey({ apiKey, onDone }: { apiKey: string; onDone: () => void }) {
  return (
    <Reveal title="Copy this key now" value={apiKey} note="This is the only time it is shown. Lost keys can be revoked and replaced." onDone={onDone}>
      <p>To use it in Claude Code, run:</p>
      <CodeLine text={claudeCommand(apiKey)} />
    </Reveal>
  );
}

export function Keys({ user }: { user: User }) {
  const { data: keys, error, reload } = useData<ApiKey[]>("/keys");
  const [newKey, setNewKey] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const isAdmin = user.role === "admin";

  const create = useSubmit(async (f, form) => {
    const { key } = await api<{ key: string }>("/keys", { body: { name: f.name } });
    form.reset();
    setNewKey(key);
    reload();
  });

  const revoke = (k: ApiKey) => {
    if (!confirm(`Revoke "${k.name}"? Clients using it stop working immediately.`)) return;
    api(`/keys/${k.id}`, { method: "DELETE" }).then(reload, (e: Error) => setActionError(e.message));
  };

  return (
    <>
      <PageHeader title="API keys">
        {isAdmin ? "Everyone's keys. Revoking one cuts off that client on its next request." : "Keys let your MCP clients use the gateway as you."}
      </PageHeader>

      {newKey ? (
        <NewKey apiKey={newKey} onDone={() => setNewKey(undefined)} />
      ) : (
        <form className="panel inline-form" onSubmit={create.onSubmit}>
          <label>
            Key name
            <input name="name" placeholder="e.g. Claude Code on my laptop" required />
          </label>
          <button disabled={create.busy}>Create key</button>
          <ErrorText>{create.error}</ErrorText>
        </form>
      )}

      <ErrorText>{error ?? actionError}</ErrorText>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Key</th>
              {isAdmin && <th>Owner</th>}
              <th>Created</th>
              <th>Last used</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keys?.map((k) => (
              <tr key={k.id} className={k.revoked_at ? "dim" : undefined}>
                <td>{k.name}</td>
                <td>
                  <code>{k.prefix}…</code>
                </td>
                {isAdmin && <td>{k.user_email}</td>}
                <td className="nowrap">{formatTime(k.created_at)}</td>
                <td className="nowrap">{timeAgo(k.last_used_at)}</td>
                <td className="nowrap">{k.revoked_at ? `Revoked ${timeAgo(k.revoked_at)}` : "Active"}</td>
                <td>
                  {!k.revoked_at && (
                    <button className="ghost small danger" onClick={() => revoke(k)}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {keys?.length === 0 && <p className="empty">No keys yet. Create one to connect your first MCP client.</p>}
    </>
  );
}
