import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, useAdmin } from "../admin.tsx";
import type { ListUsersResponse, UserRowDto } from "../backend/types.ts";
import { copy } from "../copy.ts";
import { formatDate, formatNumber, formatRelative, providerLabel } from "../format.ts";
import { Avatar, ErrorPanel, Skeleton, StatusBadges } from "../ui/bits.tsx";
import { UserDrawer } from "./UserDrawer.tsx";

const PAGE_SIZE = 25;

export function Users({ selfUid }: { selfUid: string }) {
  const { run } = useAdmin();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState("");
  const [rows, setRows] = useState<UserRowDto[]>([]);
  const [meta, setMeta] = useState<Pick<ListUsersResponse, "mode" | "scanned" | "truncated" | "nextPageToken"> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const request = useRef(0);

  const load = useCallback(
    async (q: string, pageToken: string | null) => {
      const id = ++request.current;
      setLoading(true);
      setError(null);
      try {
        const res = await run("adminListUsers", { query: q || null, pageToken, pageSize: PAGE_SIZE });
        if (id !== request.current) return;
        setRows((prev) => (pageToken ? [...prev, ...res.users] : res.users));
        setMeta({ mode: res.mode, scanned: res.scanned, truncated: res.truncated, nextPageToken: res.nextPageToken });
      } catch (e) {
        if (id === request.current) setError(errorMessage(e));
      } finally {
        if (id === request.current) setLoading(false);
      }
    },
    [run],
  );

  useEffect(() => {
    void load("", null);
  }, [load]);

  function search(q: string) {
    setActive(q.trim());
    setRows([]);
    void load(q.trim(), null);
  }

  function replace(uid: string, user: UserRowDto | null) {
    setRows((prev) => (user ? prev.map((r) => (r.uid === uid ? user : r)) : prev.filter((r) => r.uid !== uid)));
    if (!user) setSelected(null);
  }

  const firstLoad = loading && rows.length === 0;

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>{copy.users.title}</h1>
          <p className="muted small">{copy.users.subtitle}</p>
        </div>
      </header>

      <form
        className="searchbar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          search(query);
        }}
      >
        <svg className="searchbar-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          className="input"
          type="search"
          value={query}
          maxLength={200}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={copy.users.searchPlaceholder}
          aria-label={copy.users.searchPlaceholder}
          autoComplete="off"
          spellCheck={false}
        />
        {active && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setQuery("");
              search("");
            }}
          >
            {copy.users.clear}
          </button>
        )}
        <button type="submit" className="btn btn-primary btn-sm">
          {copy.users.search}
        </button>
      </form>

      {meta && active && (
        <p className="small muted">
          {meta.mode === "exact" ? copy.users.exact : copy.users.scanned(meta.scanned)} {meta.truncated && <span className="tone-ember">{copy.users.truncated}</span>}
        </p>
      )}
      {error && <ErrorPanel message={error} onRetry={() => load(active, null)} />}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{copy.users.columns.user}</th>
              <th className="col-providers">{copy.users.columns.providers}</th>
              <th className="col-date">{copy.users.columns.created}</th>
              <th className="col-date">{copy.users.columns.lastSignIn}</th>
              <th className="col-status">{copy.users.columns.status}</th>
              <th className="num col-count">{copy.dashboard.arcs}</th>
              <th className="num col-count">{copy.dashboard.habits}</th>
              <th className="num col-count">{copy.dashboard.checkIns}</th>
            </tr>
          </thead>
          <tbody>
            {firstLoad &&
              Array.from({ length: 8 }, (_, i) => (
                <tr key={i} className="row-skeleton">
                  <td><Skeleton width={220} /></td>
                  <td className="col-providers"><Skeleton width={60} /></td>
                  <td className="col-date"><Skeleton width={80} /></td>
                  <td className="col-date"><Skeleton width={70} /></td>
                  <td className="col-status"><Skeleton width={56} /></td>
                  <td className="num col-count"><Skeleton width={24} /></td>
                  <td className="num col-count"><Skeleton width={24} /></td>
                  <td className="num col-count"><Skeleton width={36} /></td>
                </tr>
              ))}
            {rows.map((u) => (
              <tr key={u.uid} className={`row ${u.disabled ? "row-disabled" : ""}`} onClick={() => setSelected(u.uid)}>
                <td>
                  <button type="button" className="user-cell" onClick={() => setSelected(u.uid)}>
                    <Avatar name={u.displayName} email={u.email} photo={u.photoURL} />
                    <span className="user-cell-text">
                      <span className="user-email">{u.email ?? copy.users.noEmail}</span>
                      <span className="user-name">
                        {u.displayName ?? copy.users.noName}
                        {u.uid === selfUid && <span className="you"> · you</span>}
                      </span>
                      <span className="mobile-status">
                        <StatusBadges disabled={u.disabled} isAdmin={u.isAdmin} emailVerified={u.emailVerified} />
                      </span>
                    </span>
                  </button>
                </td>
                <td className="col-providers">
                  <span className="muted">{u.providers.map(providerLabel).join(", ") || "—"}</span>
                </td>
                <td className="col-date" title={u.createdAt ?? ""}>
                  {formatDate(u.createdAt)}
                </td>
                <td className="col-date" title={u.lastSignIn ?? ""}>
                  {formatRelative(u.lastSignIn)}
                </td>
                <td className="col-status">
                  <StatusBadges disabled={u.disabled} isAdmin={u.isAdmin} emailVerified={u.emailVerified} />
                </td>
                <td className="num col-count">{u.counts ? formatNumber(u.counts.arcs) : "—"}</td>
                <td className="num col-count">{u.counts ? formatNumber(u.counts.habits) : "—"}</td>
                <td className="num col-count tone-ember">{u.counts ? formatNumber(u.counts.checkIns) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && rows.length === 0 && !error && <p className="empty">{copy.users.empty}</p>}
      </div>

      {meta?.nextPageToken && (
        <div className="load-more">
          <button type="button" className="btn btn-ghost" onClick={() => load(active, meta.nextPageToken)} disabled={loading}>
            {loading ? <span className="spinner" aria-hidden /> : null}
            {copy.users.loadMore}
          </button>
        </div>
      )}

      {selected && <UserDrawer uid={selected} selfUid={selfUid} onClose={() => setSelected(null)} onChanged={replace} />}
    </section>
  );
}
