import type { ISODate } from "./dates.ts";

export interface Habit {
  id: string;
  name: string;
  emoji: string;
  createdAt: string;
}

export interface Arc {
  id: string;
  title: string;
  startDate: ISODate;
  endDate: ISODate;
  habits: Habit[];
}

export interface CheckIn {
  habitId: string;
  date: ISODate;
}

export interface HabitStats {
  habit: Habit;
  totalDone: number;
  currentStreak: number;
  longestStreak: number;
  doneToday: boolean;
}

export interface ForgeRank {
  name: string;
  emoji: string;
  /** Minimum perfect days needed to reach this rank. */
  minPerfectDays: number;
}

export interface ArcStats {
  title: string;
  today: ISODate;
  /** 1-based day of the arc, clamped to [0, totalDays]. 0 means the arc hasn't started. */
  day: number;
  totalDays: number;
  daysRemaining: number;
  status: "upcoming" | "active" | "finished";
  /** Share of possible check-ins completed so far, 0–1. */
  completionRate: number;
  /** Days where every habit was checked in. */
  perfectDays: number;
  /** Consecutive perfect days ending today (or yesterday if today isn't done yet). */
  perfectStreak: number;
  rank: ForgeRank;
  nextRank: ForgeRank | null;
  habits: HabitStats[];
}
