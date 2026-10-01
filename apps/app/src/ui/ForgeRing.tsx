import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../platform/feedback.ts";
import { Icon } from "./Icon.tsx";

interface Props {
  done: number;
  total: number;
  label: string;
}

const R = 50;
const C = 2 * Math.PI * R;

/** Animates an integer towards `value` (ticks up/down one step at a time); instant with reduced motion. */
export function useTicker(value: number, stepMs = 70): number {
  const [shown, setShown] = useState(value);
  const current = useRef(value);
  useEffect(() => {
    if (prefersReducedMotion()) {
      current.current = value;
      setShown(value);
      return;
    }
    const id = setInterval(() => {
      if (current.current === value) return clearInterval(id);
      current.current += current.current < value ? 1 : -1;
      setShown(current.current);
    }, stepMs);
    return () => clearInterval(id);
  }, [value, stepMs]);
  return shown;
}

/**
 * "Forge heat": a ring that heats from ice to ember as today's habits get done, and glows on a
 * perfect day. The visible count ticks up with each check-in.
 */
export function ForgeRing({ done, total, label }: Props) {
  const fraction = total === 0 ? 0 : Math.min(1, done / total);
  const complete = total > 0 && done >= total;
  const shown = useTicker(done);
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
      <div className="ring-center" aria-hidden="true">
        <span className="ring-icon">
          <Icon name={fraction > 0 ? "flame" : "snow"} size={16} strokeWidth={2} />
        </span>
        <span className="ring-count">
          {shown}
          <small>/{total}</small>
        </span>
      </div>
    </div>
  );
}
