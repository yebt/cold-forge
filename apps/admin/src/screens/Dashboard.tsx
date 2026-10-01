import { useCallback, useEffect, useState } from "react";
import { errorMessage, useAdmin } from "../admin.tsx";
import type { StatsResponse } from "../backend/types.ts";
import { copy } from "../copy.ts";
import { formatNumber, formatRelative } from "../format.ts";
import { ErrorPanel, Skeleton } from "../ui/bits.tsx";

export function Dashboard() {
  const { run } = useAdmin();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStats(await run("adminStats", {}));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [run]);

  useEffect(() => {
    void load();
  }, [load]);

  const s = stats;
  const pct = (n: number) => (s && s.totalUsers > 0 ? `${Math.round((n / s.totalUsers) * 100)}% of users` : "");

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>{copy.dashboard.title}</h1>
          <p className="muted small">{s ? copy.dashboard.generated(formatRelative(s.generatedAt)) : copy.dashboard.subtitle}</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
          {loading ? <span className="spinner" aria-hidden /> : <RefreshIcon />}
          {copy.dashboard.refresh}
        </button>
      </header>

      {error && <ErrorPanel message={error} onRetry={load} />}
      {s?.usersCapped && <p className="notice">{copy.dashboard.capped}</p>}

      <h2 className="section-label">{copy.dashboard.accounts}</h2>
      <div className="stats-grid">
        <Stat label={copy.dashboard.totalUsers} value={s?.totalUsers} hero />
        <Stat label={copy.dashboard.active7d} value={s?.active7d} hint={s ? pct(s.active7d) : undefined} tone="ice" />
        <Stat label={copy.dashboard.signups7d} value={s?.signups7d} tone="ember" />
        <Stat label={copy.dashboard.signups30d} value={s?.signups30d} />
        <Stat label={copy.dashboard.disabled} value={s?.disabledUsers} tone={s && s.disabledUsers > 0 ? "danger" : undefined} />
        <Stat label={copy.dashboard.admins} value={s?.admins} />
      </div>

      <h2 className="section-label">{copy.dashboard.content}</h2>
      <div className="stats-grid stats-grid-3">
        <Stat label={copy.dashboard.arcs} value={s?.totals.arcs} />
        <Stat label={copy.dashboard.habits} value={s?.totals.habits} />
        <Stat label={copy.dashboard.checkIns} value={s?.totals.checkIns} tone="ember" />
      </div>
    </section>
  );
}

function Stat({ label, value, hint, tone, hero }: { label: string; value: number | undefined; hint?: string; tone?: "ice" | "ember" | "danger"; hero?: boolean }) {
  return (
    <div className={`stat ${hero ? "stat-hero" : ""}`}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ? `tone-${tone}` : ""}`}>{value === undefined ? <Skeleton width={72} height={28} /> : formatNumber(value)}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
    </svg>
  );
}
