import { useEffect, useState, type MouseEvent } from "react";
import { api, type User } from "./api";
import { Icon, Logo } from "./icons";
import { Audit } from "./pages/Audit";
import { Chat } from "./pages/Chat";
import { Keys } from "./pages/Keys";
import { Metrics } from "./pages/Metrics";
import { Servers } from "./pages/Servers";
import { SignIn } from "./pages/SignIn";
import { Team } from "./pages/Team";

const PAGES = [
  { path: "/", label: "Servers", icon: "servers", page: Servers },
  { path: "/chat", label: "Chat", icon: "chat", page: Chat },
  { path: "/keys", label: "API keys", icon: "keys", page: Keys },
  { path: "/team", label: "Team", icon: "team", page: Team, adminOnly: true },
  { path: "/audit", label: "Audit log", icon: "audit", page: Audit },
  { path: "/metrics", label: "Metrics", icon: "metrics", page: Metrics, adminOnly: true },
] as const;

function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = (to: string) => {
    window.history.pushState(null, "", to);
    setPath(to);
  };
  return [path, navigate] as const;
}

export function App() {
  const [path, navigate] = usePath();
  const [user, setUser] = useState<User | null>();

  const loadUser = () => api<User>("/me").then(setUser, () => setUser(null));
  useEffect(() => {
    loadUser();
    const onSignedOut = () => setUser(null);
    window.addEventListener("signed-out", onSignedOut);
    return () => window.removeEventListener("signed-out", onSignedOut);
  }, []);

  const inviteToken = path.match(/^\/invite\/(.+)$/)?.[1];
  if (user === undefined) return null;
  if (!user || inviteToken) {
    return <SignIn inviteToken={inviteToken} onSignedIn={() => (navigate("/"), loadUser())} />;
  }

  const isAdmin = user.role === "admin";
  const pages = PAGES.filter((p) => !("adminOnly" in p) || isAdmin);
  const current = pages.find((p) => p.path === path) ?? pages[0];
  if (current.path !== path) window.history.replaceState(null, "", current.path);
  const link = (p: (typeof pages)[number]) => (
    <a
      key={p.path}
      href={p.path}
      onClick={(e: MouseEvent) => (e.preventDefault(), navigate(p.path))}
      aria-current={p === current ? "page" : undefined}
    >
      <Icon name={p.icon} />
      {p.label}
    </a>
  );
  const signOut = () => api("/logout", { method: "POST" }).finally(() => setUser(null));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Logo />
          Urumi
        </div>
        <nav className="nav-group">{pages.filter((p) => !("adminOnly" in p)).map(link)}</nav>
        {isAdmin && (
          <nav className="nav-group">
            <span className="nav-label">Admin</span>
            {pages.filter((p) => "adminOnly" in p).map(link)}
          </nav>
        )}
        <div className="me">
          <span className="avatar">{user.name[0]?.toUpperCase()}</span>
          <div className="me-text">
            {user.name}
            <small>{user.email}</small>
          </div>
          <button className="ghost small" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="content" key={current.path}>
        <current.page user={user} />
      </main>
    </div>
  );
}
