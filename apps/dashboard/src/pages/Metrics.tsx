import type { Stat } from "../api";
import { ErrorText, PageHeader, timeAgo, useData } from "../ui";

function StatsTable({ rows, byTool }: { rows: Stat[]; byTool?: boolean }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{byTool ? "Tool" : "Server"}</th>
            <th className="num">Calls</th>
            <th className="num">Failed</th>
            <th className="num">Error rate</th>
            <th className="num">p50</th>
            <th className="num">p95</th>
            <th>Last call</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.server_slug}/${r.tool}`}>
              <td>{byTool ? <code>{r.server_slug ? `${r.server_slug}__${r.tool}` : r.tool}</code> : (r.server_slug ?? "Unknown tool")}</td>
              <td className="num">{r.calls}</td>
              <td className="num">{r.failed}</td>
              <td className={`num ${r.failed ? "failed" : ""}`}>{Math.round((r.failed / r.calls) * 100)}%</td>
              <td className="num">{r.p50_ms} ms</td>
              <td className="num">{r.p95_ms} ms</td>
              <td>{timeAgo(r.last_call)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Metrics() {
  const { data, error } = useData<{ servers: Stat[]; tools: Stat[] }>("/metrics", 10000);

  return (
    <>
      <PageHeader title="Metrics">Tool calls in the last 24 hours, from the audit log. p95 is the time that 95% of calls stay under.</PageHeader>
      <ErrorText>{error}</ErrorText>
      {data && data.servers.length === 0 && <p className="empty">No tool calls in the last 24 hours.</p>}
      {data && data.servers.length > 0 && (
        <>
          <h2 className="section-title">By server</h2>
          <StatsTable rows={data.servers} />
          <h2 className="section-title">By tool</h2>
          <StatsTable rows={data.tools} byTool />
        </>
      )}
    </>
  );
}
