import { addDays, diffDays, eachDay, type ISODate } from "./dates.ts";
import type { Arc, ArcStats, CheckIn, ForgeRank, HabitStats } from "./types.ts";

/** The classic Winter Arc: October 1st to December 31st. */
export function winterArcWindow(year: number): { startDate: ISODate; endDate: ISODate } {
  return { startDate: `${year}-10-01`, endDate: `${year}-12-31` };
}

export function arcLength(arc: Pick<Arc, "startDate" | "endDate">): number {
  return diffDays(arc.startDate, arc.endDate) + 1;
}

export const FORGE_RANKS: readonly ForgeRank[] = [
  { name: "Mineral crudo", emoji: "🪨", minPerfectDays: 0 },
  { name: "Hierro", emoji: "⛓️", minPerfectDays: 7 },
  { name: "Acero", emoji: "🗡️", minPerfectDays: 21 },
  { name: "Acero templado", emoji: "⚔️", minPerfectDays: 45 },
  { name: "Damasco", emoji: "🛡️", minPerfectDays: 70 },
  { name: "Forjado en hielo", emoji: "🧊", minPerfectDays: 90 },
];

export function rankFor(perfectDays: number): { rank: ForgeRank; nextRank: ForgeRank | null } {
  let index = 0;
  FORGE_RANKS.forEach((r, i) => {
    if (perfectDays >= r.minPerfectDays) index = i;
  });
  return { rank: FORGE_RANKS[index]!, nextRank: FORGE_RANKS[index + 1] ?? null };
}

/**
 * Length of the run of consecutive days in `done` ending at `today`.
 * If `today` isn't done yet the streak is still alive, so we count back from yesterday.
 */
export function currentStreak(done: ReadonlySet<ISODate>, today: ISODate): number {
  let cursor = done.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (done.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function longestStreak(done: ReadonlySet<ISODate>): number {
  let longest = 0;
  for (const day of done) {
    if (done.has(addDays(day, -1))) continue; // only start counting at the beginning of a run
    let length = 1;
    while (done.has(addDays(day, length))) length++;
    longest = Math.max(longest, length);
  }
  return longest;
}

export function computeArcStats(arc: Arc, checkIns: readonly CheckIn[], today: ISODate): ArcStats {
  const totalDays = arcLength(arc);
  const rawDay = diffDays(arc.startDate, today) + 1;
  const status = rawDay < 1 ? "upcoming" : rawDay > totalDays ? "finished" : "active";
  const day = Math.min(Math.max(rawDay, 0), totalDays);

  const inArc = (d: ISODate) => d >= arc.startDate && d <= arc.endDate && d <= today;
  const doneByHabit = new Map<string, Set<ISODate>>(arc.habits.map((h) => [h.id, new Set()]));
  for (const c of checkIns) {
    if (inArc(c.date)) doneByHabit.get(c.habitId)?.add(c.date);
  }

  const habits: HabitStats[] = arc.habits.map((habit) => {
    const done = doneByHabit.get(habit.id)!;
    return {
      habit,
      totalDone: done.size,
      currentStreak: currentStreak(done, today),
      longestStreak: longestStreak(done),
      doneToday: done.has(today),
    };
  });

  const elapsed = day === 0 ? [] : eachDay(arc.startDate, addDays(arc.startDate, day - 1));
  const perfect = new Set(
    arc.habits.length === 0
      ? []
      : elapsed.filter((d) => arc.habits.every((h) => doneByHabit.get(h.id)!.has(d))),
  );

  // Today is still in progress, so it only counts towards the denominator once something is done.
  const todayStarted = habits.some((h) => h.doneToday);
  const countedDays = status === "active" && !todayStarted ? day - 1 : day;
  const possible = countedDays * arc.habits.length;
  const totalDone = habits.reduce((sum, h) => sum + h.totalDone, 0);

  return {
    title: arc.title,
    today,
    day,
    totalDays,
    daysRemaining: totalDays - day,
    status,
    completionRate: possible === 0 ? 0 : Math.min(totalDone / possible, 1),
    perfectDays: perfect.size,
    perfectStreak: currentStreak(perfect, today),
    ...rankFor(perfect.size),
    habits,
  };
}
