/** Calendar day in `YYYY-MM-DD` form. All arc math is done on whole days, timezone-free. */
export type ISODate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  return toISODate(parseISODate(value)) === value;
}

/** Parses a `YYYY-MM-DD` string as a UTC midnight timestamp. */
export function parseISODate(date: ISODate): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

export function toISODate(timestamp: number): ISODate {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** Today's calendar date in the local timezone of the runtime. */
export function localToday(now = new Date()): ISODate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(date: ISODate, days: number): ISODate {
  return toISODate(parseISODate(date) + days * MS_PER_DAY);
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((parseISODate(b) - parseISODate(a)) / MS_PER_DAY);
}

export function eachDay(start: ISODate, end: ISODate): ISODate[] {
  const days: ISODate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}
