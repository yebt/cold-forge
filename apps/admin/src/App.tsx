import { useEffect, useState, type ReactNode } from "react";
import { AdminProvider } from "./admin.tsx";
import type { AuthState, Backend, Session } from "./backend/types.ts";
import { copy } from "./copy.ts";
import { AuditLog } from "./screens/AuditLog.tsx";
import { Dashboard } from "./screens/Dashboard.tsx";
import { SignIn } from "./screens/SignIn.tsx";
import { Users } from "./screens/Users.tsx";
import { Avatar, Logo } from "./ui/bits.tsx";

type Route = "dashboard" | "users" | "audit";
const ROUTES: Route[] = ["dashboard", "users", "audit"];
const IDLE_MS = 30 * 60_000;

function readRoute(): Route {
  const r = location.hash.replace(/^#\/?/, "") as Route;
  return ROUTES.includes(r) ? r : "dashboard";
}

export function App({ backend }: { backend: Backend }) {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  useEffect(() => backend.subscribe(setAuth), [backend]);

  if (auth.status === "loading") {
    return (
      <div className="splash" aria-busy="true">
        <Logo size={48} />
      </div>
    );
  }
  if (auth.status === "signed-out") return <SignIn backend={backend} state={auth} />;
  return (
    <AdminProvider backend={backend}>
      <Shell backend={backend} session={auth.session} />
    </AdminProvider>
  );
}

function Shell({ backend, session }: { backend: Backend; session: Session }) {
  const [route, setRoute] = useState<Route>(readRoute);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Sign out after 30 idle minutes: an unattended admin tab is the easiest way in.
  useEffect(() => {
    let timer = setTimeout(expire, IDLE_MS);
    function expire() {
      void backend.signOut("idle");
    }
    function bump() {
      clearTimeout(timer);
      timer = setTimeout(expire, IDLE_MS);
    }
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, bump, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, bump);
    };
  }, [backend]);

  const nav: Array<{ id: Route; label: string; icon: ReactNode }> = [
    { id: "dashboard", label: copy.nav.dashboard, icon: <IconGrid /> },
    { id: "users", label: copy.nav.users, icon: <IconUsers /> },
    { id: "audit", label: copy.nav.audit, icon: <IconLog /> },
  ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Logo />
          <div>
            <div className="brand">{copy.brand}</div>
            <div className="eyebrow">{copy.product}</div>
          </div>
          {backend.banner && <span className="mock-pill">{backend.banner}</span>}
        </div>
        <nav className="nav" aria-label="Main">
          {nav.map((n) => (
            <a key={n.id} href={`#/${n.id}`} className={`nav-item ${route === n.id ? "active" : ""}`} aria-current={route === n.id ? "page" : undefined}>
              {n.icon}
              <span>{n.label}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-session">
          <Avatar name={session.displayName} email={session.email} photo={session.photoURL} size={30} />
          <div className="session-text">
            <div className="xsmall muted">{copy.session.signedInAs}</div>
            <div className="small ellipsis" title={session.email}>
              {session.email}
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => backend.signOut()}>
            {copy.session.signOut}
          </button>
        </div>
      </aside>
      <main className="main">
        {route === "dashboard" && <Dashboard />}
        {route === "users" && <Users selfUid={session.uid} />}
        {route === "audit" && <AuditLog />}
      </main>
    </div>
  );
}

const iconProps = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

function IconGrid() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg {...iconProps}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.6.8 2.6 2.5 3 5.2" />
    </svg>
  );
}

function IconLog() {
  return (
    <svg {...iconProps}>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5M9 12h7M9 16h7" />
    </svg>
  );
}
