import type { AuditRow, User } from "../api";
import { ErrorText, PageHeader, formatTime, useData } from "../ui";

export function Audit({ user }: { user: User }) {
  const { data: rows, error } = useData<AuditRow[]>("/audit", 5000);

  return (
    <>
      <PageHeader title="Audit log">
        {user.role === "admin" ? "Every tool call by everyone on the team, newest first." : "Your tool calls, newest first."}
      </PageHeader>
      <ErrorText>{error}</ErrorText>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Tool</th>
              <th>From</th>
              <th className="num">Duration</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.id}>
                <td className="nowrap">{formatTime(r.at)}</td>
                <td>{r.user_email}</td>
                <td>
                  <code>{r.server_slug ? `${r.server_slug}__${r.tool}` : r.tool}</code>
                </td>
                <td className="nowrap">{r.source === "chat" ? "Chat" : "MCP client"}</td>
                <td className="num">{r.duration_ms} ms</td>
                <td className={r.ok ? "ok" : "failed"}>{r.ok ? "Succeeded" : `Failed: ${r.error}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows?.length === 0 && <p className="empty">No tool calls yet. They show up here as soon as someone uses a tool.</p>}
    </>
  );
}
