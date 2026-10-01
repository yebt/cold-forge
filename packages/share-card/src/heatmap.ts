import { eachDay, type CheckIn, type ISODate } from "@cold-forge/core";

export type HeatmapState = "past" | "today" | "future";

export interface HeatmapCell {
  date: ISODate;
  /** 0–1 share of the arc's habits checked in that day. */
  fraction: number;
  /** 0 (nothing) … HEATMAP_LEVELS - 1 (every habit done). */
  level: number;
  state: HeatmapState;
}

/** Number of shading steps, including "nothing done". */
export const HEATMAP_LEVELS = 5;

/** Maps a completion fraction to a shading level. Only a perfect day gets the top level. */
export function heatmapLevel(fraction: number, levels: number = HEATMAP_LEVELS): number {
  if (!(fraction > 0)) return 0;
  if (fraction >= 1) return levels - 1;
  // Spread partial days over the middle levels: (0, 1) → [1, levels - 2].
  const partialLevels = levels - 2;
  return Math.min(1 + Math.floor(fraction * partialLevels), levels - 2);
}

/**
 * One cell per arc day. Check-ins for habits not in `habitIds` (e.g. deleted habits) and
 * duplicate check-ins are ignored.
 */
export function computeHeatmap(
  arc: { startDate: ISODate; endDate: ISODate },
  checkIns: readonly CheckIn[],
  habitIds: readonly string[],
  today: ISODate,
): HeatmapCell[] {
  const habits = new Set(habitIds);
  const doneByDay = new Map<ISODate, Set<string>>();
  for (const c of checkIns) {
    if (!habits.has(c.habitId)) continue;
    let set = doneByDay.get(c.date);
    if (!set) doneByDay.set(c.date, (set = new Set()));
    set.add(c.habitId);
  }
  return eachDay(arc.startDate, arc.endDate).map((date) => {
    const state: HeatmapState = date < today ? "past" : date === today ? "today" : "future";
    const done = doneByDay.get(date)?.size ?? 0;
    const fraction = habits.size === 0 || state === "future" ? 0 : done / habits.size;
    return { date, fraction, level: heatmapLevel(fraction), state };
  });
}

/** Longest run of consecutive perfect (every habit done) days in the heatmap. */
export function longestPerfectRun(cells: readonly HeatmapCell[]): number {
  let best = 0;
  let run = 0;
  for (const c of cells) {
    run = c.fraction >= 1 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}
