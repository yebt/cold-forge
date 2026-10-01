interface Props {
  done: number;
  total: number;
  label: string;
}

const R = 52;
const C = 2 * Math.PI * R;

/** "Forge heat": a ring that warms from ice to ember as today's habits get done. */
export function ForgeRing({ done, total, label }: Props) {
  const fraction = total === 0 ? 0 : done / total;
  const complete = total > 0 && done >= total;
  return (
    <div
      className={`forge-ring${complete ? " complete" : ""}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      style={{ ["--heat" as string]: fraction }}
    >
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <defs>
          <linearGradient id="heat-grad" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="55%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#f97316" />
          </linearGradient>
        </defs>
        <circle className="ring-track" cx="60" cy="60" r={R} />
        <circle
          className="ring-fill"
          cx="60"
          cy="60"
          r={R}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - fraction)}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div className="ring-center">
        <span className="ring-emoji" aria-hidden="true">
          {complete ? "🔥" : fraction > 0 ? "⚒️" : "🧊"}
        </span>
        <span className="ring-count">
          {done}
          <small>/{total}</small>
        </span>
      </div>
    </div>
  );
}
