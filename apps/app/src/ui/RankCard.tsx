import { useApp } from "../state.tsx";

/** Current forge rank with metal emoji and progress towards the next one. */
export function RankCard() {
  const { t, derived } = useApp();
  const { m, ui } = t;
  const { rank, nextRank, perfectDays } = derived.stats;
  const fraction = nextRank
    ? (perfectDays - rank.minPerfectDays) / (nextRank.minPerfectDays - rank.minPerfectDays)
    : 1;
  return (
    <section className="card rank-card">
      <span className="rank-emoji" aria-hidden="true">
        {rank.emoji}
      </span>
      <div className="rank-body">
        <span className="eyebrow">{m.stats.rank}</span>
        <strong className="rank-name">{m.ranks[rank.id]}</strong>
        <div className="bar" aria-hidden="true">
          <div style={{ width: `${Math.round(fraction * 100)}%` }} />
        </div>
        <span className="muted small">
          {nextRank
            ? `${nextRank.emoji} ${m.stats.toNextRank(nextRank.minPerfectDays - perfectDays, m.ranks[nextRank.id])}`
            : m.stats.maxRank}
          {" · "}
          {ui.progress.rankProgress(perfectDays)}
        </span>
      </div>
    </section>
  );
}
