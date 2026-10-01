import { MILESTONE_DAYS, type ArcStats } from "@cold-forge/core";

export interface MilestoneState {
  day: number;
  reached: boolean;
}

/** A milestone is reached once the arc gets to that day. */
export function milestoneStates(stats: Pick<ArcStats, "day" | "status">): MilestoneState[] {
  return MILESTONE_DAYS.map((day) => ({ day, reached: stats.status !== "upcoming" && stats.day >= day }));
}

/**
 * The milestone to celebrate now, if any: the highest reached milestone not celebrated yet.
 * `alsoMark` lists every reached-but-uncelebrated milestone so skipped ones aren't prompted later
 * (e.g. someone who opens the app first on day 35 gets one prompt for day 30, not two).
 */
export function pendingMilestone(
  stats: Pick<ArcStats, "day" | "status">,
  celebrated: readonly number[],
): { day: number; alsoMark: number[] } | null {
  const fresh = milestoneStates(stats)
    .filter((s) => s.reached && !celebrated.includes(s.day))
    .map((s) => s.day);
  if (fresh.length === 0) return null;
  return { day: fresh[fresh.length - 1]!, alsoMark: fresh };
}
