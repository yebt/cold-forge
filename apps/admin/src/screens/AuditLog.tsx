import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, useAdmin } from "../admin.tsx";
import type { AuditEntryDto } from "../backend/types.ts";
import { copy } from "../copy.ts";
import { formatDateTime, formatRelative } from "../format.ts";
import { ErrorPanel, Skeleton } from "../ui/bits.tsx";

const ACTION_TONE: Record<AuditEntryDto["action"], string> = {
  "user.view": "",
  "user.disable": "badge-danger",
  "user.enable": "badge-ok",
  "user.delete": "badge-danger",
  unknown: "",
};

export function AuditLog() {
  const { run } = useAdmin();
  const [entries, setEntries] = useState<AuditEntryDto[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const load = useCallback(
    async (pageToken: string | null) => {
      const id = ++request.current;
      setLoading(true);
      setError(null);
      try {
        const res = await run("adminListAuditLog", { pageToken, pageSize: 50 });
        if (id !== request.current) return;
        setEntries((prev) => (pageToken ? [...prev, ...res.entries] : res.entries));
        setNext(res.nextPageToken);
      } catch (e) {
        if (id === request.current) setError(errorMessage(e));
      } finally {
        if (id === request.current) setLoading(false);
      }
    },
    [run],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  const a = copy.audit;

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>{a.title}</h1>
          <p className="muted small">{a.subtitle}</p>
        </div>
      </header>
      {error && <ErrorPanel message={error} onRetry={() => load(null)} />}
      <div className="table-wrap">
        <table className="table table-audit">
          <thead>
            <tr>
              <th>{a.when}</th>
              <th>{a.action}</th>
              <th>{a.target}</th>
              <th>{a.reason}</th>
              <th className="col-actor">{a.actor}</th>
            </tr>
          </thead>
          <tbody>
            {loading &&
              entries.length === 0 &&
              Array.from({ length: 6 }, (_, i) => (
                <tr key={i}>
                  <td><Skeleton width={90} /></td>
                  <td><Skeleton width={80} /></td>
                  <td><Skeleton width={180} /></td>
                  <td><Skeleton width={220} /></td>
                  <td className="col-actor"><Skeleton width={140} /></td>
                </tr>
              ))}
            {entries.map((e) => (
              <tr key={e.id}>
                <td title={formatDateTime(e.at)} className="nowrap">
                  {formatRelative(e.at)}
                </td>
                <td className="nowrap">
                  <span className={`badge ${ACTION_TONE[e.action]}`}>{a.actions[e.action]}</span>
                  {e.outcome === "error" && <span className="badge badge-danger badge-outline">{a.error}</span>}
                  {e.outcome === "refused" && (
                    <span className="badge badge-outline" title={e.code ?? undefined}>
                      {a.refused}
                      {e.code ? `: ${e.code}` : ""}
                    </span>
                  )}
                </td>
                <td>
                  <div className="ellipsis">{e.targetEmail ?? "—"}</div>
                  <div className="mono muted xsmall ellipsis">{e.targetUid}</div>
                </td>
                <td className="reason">{e.reason ?? <span className="muted">—</span>}</td>
                <td className="col-actor">
                  <div className="ellipsis">{e.actorEmail}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && entries.length === 0 && !error && <p className="empty">{a.empty}</p>}
      </div>
      {next && (
        <div className="load-more">
          <button type="button" className="btn btn-ghost" onClick={() => load(next)} disabled={loading}>
            {loading ? <span className="spinner" aria-hidden /> : null}
            {a.loadMore}
          </button>
        </div>
      )}
    </section>
  );
}
