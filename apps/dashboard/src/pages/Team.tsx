import { useState } from "react";
import { api, type TeamMember, type User } from "../api";
import { ErrorText, PageHeader, Reveal, formatTime, useData, useSubmit } from "../ui";
import { NewKey } from "./Keys";

export function Team({ user }: { user: User }) {
  const { data: members, error, reload } = useData<TeamMember[]>("/users");
  const [inviteUrl, setInviteUrl] = useState<string>();
  const [issued, setIssued] = useState<string>();
  const [actionError, setActionError] = useState<string>();

  const invite = useSubmit(async (f, form) => {
    const res = await api<{ inviteUrl: string }>("/users", { body: f });
    form.reset();
    setInviteUrl(res.inviteUrl);
    reload();
  });

  const fail = (e: Error) => setActionError(e.message);
  const issueKey = (m: TeamMember) =>
    api<{ key: string }>("/keys", { body: { name: `Issued by ${user.name}`, userId: m.id } }).then((r) => setIssued(r.key), fail);
  const remove = (m: TeamMember) => {
    if (confirm(`Remove ${m.name}? Their keys stop working immediately.`)) api(`/users/${m.id}`, { method: "DELETE" }).then(reload, fail);
  };

  return (
    <>
      <PageHeader title="Team">Admins manage servers and people. Members use the tools.</PageHeader>

      {inviteUrl && (
        <Reveal
          title="Send this invite link"
          value={inviteUrl}
          note="It works once. The person sets their own password when they open it."
          onDone={() => setInviteUrl(undefined)}
        />
      )}
      {issued && <NewKey apiKey={issued} onDone={() => setIssued(undefined)} />}

      <form className="panel inline-form" onSubmit={invite.onSubmit}>
        <label>
          Name
          <input name="name" required />
        </label>
        <label>
          Email
          <input name="email" type="email" required />
        </label>
        <label>
          Role
          <select name="role" defaultValue="member">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button disabled={invite.busy}>Invite</button>
        <ErrorText>{invite.error}</ErrorText>
      </form>

      <ErrorText>{error ?? actionError}</ErrorText>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Joined</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members?.map((m) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td>{m.email}</td>
                <td>{m.role === "admin" ? "Admin" : "Member"}</td>
                <td>{m.invited ? "Invite pending" : "Active"}</td>
                <td className="nowrap">{formatTime(m.created_at)}</td>
                <td>
                  <div className="row-actions">
                    <button className="ghost small" onClick={() => issueKey(m)}>
                      Issue key
                    </button>
                    {m.id !== user.id && (
                      <button className="ghost small danger" onClick={() => remove(m)}>
                        Remove
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
