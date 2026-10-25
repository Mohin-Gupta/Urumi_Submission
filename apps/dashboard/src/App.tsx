import { useEffect, useState, type MouseEvent } from "react";
import { api, type User } from "./api";
import { Audit } from "./pages/Audit";
import { Keys } from "./pages/Keys";
import { Servers } from "./pages/Servers";
import { SignIn } from "./pages/SignIn";
import { Team } from "./pages/Team";

const PAGES = [
  { path: "/", label: "Servers", page: Servers },
  { path: "/keys", label: "API keys", page: Keys },
  { path: "/team", label: "Team", page: Team, adminOnly: true },
  { path: "/audit", label: "Audit log", page: Audit },
];

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

  const pages = PAGES.filter((p) => !p.adminOnly || user.role === "admin");
  const current = pages.find((p) => p.path === path) ?? pages[0];
  const link = (to: string) => (e: MouseEvent) => {
    e.preventDefault();
    navigate(to);
  };
  const signOut = () => api("/logout", { method: "POST" }).finally(() => setUser(null));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Urumi Gateway</div>
        <nav>
          {pages.map((p) => (
            <a key={p.path} href={p.path} onClick={link(p.path)} aria-current={p === current ? "page" : undefined}>
              {p.label}
            </a>
          ))}
        </nav>
        <div className="me">
          <span>{user.name}</span>
          <span className="muted">{user.role === "admin" ? "Admin" : "Member"}</span>
          <button className="ghost small" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">
        <current.page user={user} />
      </main>
    </div>
  );
}
