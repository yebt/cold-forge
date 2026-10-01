import { addDays, diffDays, eachDay, type ISODate } from "./dates.ts";
import type { Arc, ArcStats, CheckIn, ForgeRank, HabitStats } from "./types.ts";

/** Length of a Winter Arc: October 1st to December 31st. Custom arcs reuse it so late joiners still get the full run. */
export const ARC_DAYS = 92;

/** Days worth celebrating with their own share card. */
export const MILESTONE_DAYS = [7, 30, 50, 75, ARC_DAYS] as const;

/** The classic Winter Arc: October 1st to December 31st. */
export function winterArcWindow(year: number): { startDate: ISODate; endDate: ISODate } {
  return { startDate: `${year}-10-01`, endDate: `${year}-12-31` };
}

/** A personal arc of `days` days starting on `startDate` ("my 92 days from today"). */
export function arcWindowFrom(startDate: ISODate, days: number = ARC_DAYS): { startDate: ISODate; endDate: ISODate } {
  return { startDate, endDate: addDays(startDate, days - 1) };
}

export function arcLength(arc: Pick<Arc, "startDate" | "endDate">): number {
  return diffDays(arc.startDate, arc.endDate) + 1;
}

export const FORGE_RANKS: readonly ForgeRank[] = [
  { id: "ore", emoji: "🪨", minPerfectDays: 0 },
  { id: "iron", emoji: "⛓️", minPerfectDays: 7 },
  { id: "steel", emoji: "🗡️", minPerfectDays: 21 },
  { id: "tempered", emoji: "⚔️", minPerfectDays: 45 },
  { id: "damascus", emoji: "🛡️", minPerfectDays: 70 },
  { id: "iceForged", emoji: "🧊", minPerfectDays: 90 },
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

  // Once the arc is over, streaks are frozen as of its last day instead of decaying to 0.
  const streakDay = status === "finished" ? arc.endDate : today;
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
      currentStreak: currentStreak(done, streakDay),
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
    perfectStreak: currentStreak(perfect, streakDay),
    ...rankFor(perfect.size),
    habits,
  };
}

export type HabitTemplateId =
  | "coldShower"
  | "gym"
  | "read"
  | "wakeEarly"
  | "noSugar"
  | "lessSocial"
  | "meditate"
  | "steps"
  | "water"
  | "journal";

/** One-tap starter habits. Display names live in `@cold-forge/i18n`, keyed by `id`. */
export const HABIT_TEMPLATES: readonly { id: HabitTemplateId; emoji: string }[] = [
  { id: "coldShower", emoji: "🧊" },
  { id: "gym", emoji: "🏋️" },
  { id: "read", emoji: "📚" },
  { id: "wakeEarly", emoji: "⏰" },
  { id: "noSugar", emoji: "🚫" },
  { id: "lessSocial", emoji: "📵" },
  { id: "meditate", emoji: "🧘" },
  { id: "steps", emoji: "🚶" },
  { id: "water", emoji: "💧" },
  { id: "journal", emoji: "📓" },
];
