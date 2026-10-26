import { api } from "../api";
import { ErrorText, useSubmit } from "../ui";

// Handles both normal sign-in and accepting an invite (setting a first password)
export function SignIn({ inviteToken, onSignedIn }: { inviteToken?: string; onSignedIn: () => void }) {
  const { onSubmit, error, busy } = useSubmit(async (f) => {
    if (inviteToken) await api("/invites/accept", { body: { token: inviteToken, password: f.password } });
    else await api("/login", { body: f });
    onSignedIn();
  });

  return (
    <main className="signin">
      <form className="panel" onSubmit={onSubmit}>
        <div className="brand">
          <span className="brand-mark" />
          Urumi
        </div>
        <h1>{inviteToken ? "Join your team" : "Sign in"}</h1>
        <p className="muted">
          {inviteToken ? "You've been invited. Choose a password to join your team." : "Sign in to your team's MCP gateway."}
        </p>
        {!inviteToken && (
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required autoFocus />
          </label>
        )}
        <label>
          {inviteToken ? "New password" : "Password"}
          <input
            name="password"
            type="password"
            autoComplete={inviteToken ? "new-password" : "current-password"}
            minLength={inviteToken ? 8 : undefined}
            required
          />
        </label>
        <ErrorText>{error}</ErrorText>
        <button disabled={busy}>{inviteToken ? "Join team" : "Sign in"}</button>
      </form>
    </main>
  );
}
