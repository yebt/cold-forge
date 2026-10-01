import { FORGE_RANKS } from "@cold-forge/core";
import { useApp } from "../state.tsx";

/** Current forge rank, a 6-step bar (one step per rank) and what the next one needs. */
export function RankCard() {
  const { t, derived } = useApp();
  const { m, ui } = t;
  const { rank, nextRank, perfectDays } = derived.stats;
  const index = FORGE_RANKS.findIndex((r) => r.id === rank.id);
  return (
    <section className="card rank-card" aria-labelledby="rank-name">
      <div className="rank-head">
        <div className="rank-title">
          <span className="label">{ui.progress.rankCurrent}</span>
          <strong className="rank-name" id="rank-name">
            {m.ranks[rank.id]}
          </strong>
        </div>
        <span className="rank-next">
          {nextRank ? m.stats.toNextRank(nextRank.minPerfectDays - perfectDays, m.ranks[nextRank.id]) : m.stats.maxRank}
        </span>
      </div>
      <div
        className="rank-steps"
        role="img"
        aria-label={`${m.ranks[rank.id]} · ${index + 1}/${FORGE_RANKS.length} · ${ui.progress.rankProgress(perfectDays)}`}
      >
        {FORGE_RANKS.map((r, i) => (
          <span key={r.id} className={i <= index ? "on" : ""} />
        ))}
      </div>
      <span className="muted small">{ui.progress.rankProgress(perfectDays)}</span>
    </section>
  );
}
