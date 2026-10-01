import {

  arcWindowFrom,
  computeArcStats,
  diffDays,
  eachDay,
  winterArcWindow,
  type Arc,
  type ArcStats,
  type CheckIn,
  type ISODate,
} from "@cold-forge/core";
import type { Messages } from "@cold-forge/i18n";
import { activeHabits, isDone, type AppData, type StoredArc, type StoredHabit } from "./model.ts";

export function habitName(h: Pick<StoredHabit, "templateId" | "name">, m: Messages): string {
  return h.templateId ? m.habits[h.templateId] : h.name;
}

export function arcTitle(arc: Pick<StoredArc, "kind" | "startDate">, m: Messages): string {
  return arc.kind === "winter" ? m.arcTitles.winter(Number(arc.startDate.slice(0, 4))) : m.arcTitles.custom;
}

/** The core `Arc` with habit names resolved in the current language. */
export function toCoreArc(data: AppData, m: Messages): Arc {
  return {
    id: data.arc.id,
    title: arcTitle(data.arc, m),
    startDate: data.arc.startDate,
    endDate: data.arc.endDate,
    habits: activeHabits(data).map((h) => ({
      id: h.id,
      name: habitName(h, m),
      emoji: h.emoji,
      createdAt: h.createdAt,
    })),
  };
}

/** Check-ins for core: only `done` records of habits that still exist. */
export function deriveCheckIns(data: AppData): CheckIn[] {
  const alive = new Set(activeHabits(data).map((h) => h.id));
  return Object.values(data.checkIns)
    .filter((c) => c.done && alive.has(c.habitId))
    .map(({ habitId, date }) => ({ habitId, date }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export interface Derived {
  arc: Arc;
  checkIns: CheckIn[];
  stats: ArcStats;
}

export function derive(data: AppData, m: Messages, today: ISODate): Derived {
  const arc = toCoreArc(data, m);
  const checkIns = deriveCheckIns(data);
  return { arc, checkIns, stats: computeArcStats(arc, checkIns, today) };
}

/** Done/total for one day, over the currently active habits. */
export function dayProgress(data: AppData, date: ISODate): { done: number; total: number } {
  const habits = activeHabits(data);
  return { done: habits.filter((h) => isDone(data, h.id, date)).length, total: habits.length };
}

export type HeatCellState = "future" | "empty" | "partial" | "perfect" | "missed";

export interface HeatCell {
  date: ISODate;
  /** 1-based day of the arc. */
  day: number;
  state: HeatCellState;
  /** 0–1 share of habits done. */
  level: number;
  isToday: boolean;
  editable: boolean;
}

export function heatmap(data: AppData, today: ISODate): HeatCell[] {
  return eachDay(data.arc.startDate, data.arc.endDate).map((date, i) => {
    const { done, total } = dayProgress(data, date);
    const level = total === 0 ? 0 : done / total;
    const isFuture = date > today;
    const state: HeatCellState = isFuture
      ? "future"
      : level >= 1
        ? "perfect"
        : level > 0
          ? "partial"
          : date === today
            ? "empty"
            : "missed";
    return { date, day: i + 1, state, level, isToday: date === today, editable: !isFuture };
  });
}

export interface ArcOption {
  kind: "winter" | "custom";
  window: { startDate: ISODate; endDate: ISODate };
  status: "upcoming" | "active";
  /** Day of the arc you'd be on today (active only). */
  day: number;
  /** Days until it starts (upcoming only). */
  startsIn: number;
}

/**
 * Arc choices for onboarding. The official window is always this year's Oct 1 → Dec 31:
 * from January to September it's upcoming, from October on you join it at day N.
 */
export function arcOptions(today: ISODate): { winter: ArcOption; custom: ArcOption } {
  const winter = winterArcWindow(Number(today.slice(0, 4)));
  const startsIn = diffDays(today, winter.startDate);
  return {
    winter: {
      kind: "winter",
      window: winter,
      status: startsIn > 0 ? "upcoming" : "active",
      day: startsIn > 0 ? 0 : 1 - startsIn,
      startsIn: Math.max(startsIn, 0),
    },
    custom: { kind: "custom", window: arcWindowFrom(today), status: "active", day: 1, startsIn: 0 },
  };
}

/** Dates within the arc that can be edited (not future, not before start). */
export function isEditableDate(arc: Pick<StoredArc, "startDate" | "endDate">, date: ISODate, today: ISODate): boolean {
  return date >= arc.startDate && date <= arc.endDate && date <= today;
}

