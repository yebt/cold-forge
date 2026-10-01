import { addDays, type ISODate } from "@cold-forge/core";

export interface ReminderCopy {
  title: string;
  /** Today, with habits left and a streak at stake. */
  leftWithStreak: (left: number, streak: number) => string;
  /** Today, habits left, no streak yet. */
  left: (left: number) => string;
  /** A future day: content is static, so stay generic but personal. */
  future: (streak: number) => string;
}

export interface PlannedReminder {
  id: number;
  at: Date;
  title: string;
  body: string;
}

export interface ReminderInput {
  enabled: boolean;
  /** `HH:MM` */
  time: string;
  now: Date;
  today: ISODate;
  arcEnd: ISODate;
  arcStart: ISODate;
  habitsLeftToday: number;
  perfectStreak: number;
}

/** How many days ahead we schedule. Rescheduled on every app open and data change. */
export const REMINDER_HORIZON_DAYS = 14;
export const REMINDER_ID_BASE = 9200;

function atLocalTime(date: ISODate, time: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y!, mo! - 1, d!, h!, mi!, 0, 0);
}

/**
 * One notification per evening for the next couple of weeks. Today's is skipped when everything
 * is already done (no nagging), and nothing is scheduled outside the arc.
 * Ids are stable (`REMINDER_ID_BASE + i`) so rescheduling replaces previous ones.
 */
export function planReminders(input: ReminderInput, copy: ReminderCopy): PlannedReminder[] {
  if (!input.enabled) return [];
  const out: PlannedReminder[] = [];
  for (let i = 0; i < REMINDER_HORIZON_DAYS; i++) {
    const date = addDays(input.today, i);
    if (date < input.arcStart || date > input.arcEnd) continue;
    const at = atLocalTime(date, input.time);
    if (at.getTime() <= input.now.getTime()) continue;
    let body: string;
    if (i === 0) {
      if (input.habitsLeftToday <= 0) continue;
      body =
        input.perfectStreak > 0
          ? copy.leftWithStreak(input.habitsLeftToday, input.perfectStreak)
          : copy.left(input.habitsLeftToday);
    } else {
      // If today gets completed the streak grows; we can't know, so use the current one.
      body = copy.future(input.perfectStreak);
    }
    out.push({ id: REMINDER_ID_BASE + i, at, title: copy.title, body });
  }
  return out;
}

export const ALL_REMINDER_IDS = Array.from({ length: REMINDER_HORIZON_DAYS }, (_, i) => REMINDER_ID_BASE + i);
