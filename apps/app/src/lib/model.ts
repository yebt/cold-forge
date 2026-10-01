import { isISODate, type HabitTemplateId, type ISODate } from "@cold-forge/core";
import { isLocale, type Locale } from "@cold-forge/i18n";
import { newId } from "./ids.ts";

/**
 * Everything the app persists. Every record carries an `updatedAt` ISO timestamp so a future
 * sync API can merge devices with last-write-wins. Deletions are tombstones (`deletedAt`).
 */
export const SCHEMA_VERSION = 1;

export type ArcKind = "winter" | "custom";

export interface StoredArc {
  id: string;
  kind: ArcKind;
  startDate: ISODate;
  endDate: ISODate;
  /** One sentence of motivation shown on hard days. */
  why: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredHabit {
  id: string;
  /** Set for one-tap templates so the name follows the app language. */
  templateId?: HabitTemplateId;
  /** Custom name (used when there is no template, or when the user renamed a template habit). */
  name: string;
  emoji: string;
  order: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface CheckInRecord {
  habitId: string;
  date: ISODate;
  done: boolean;
  updatedAt: string;
}

export interface Settings {
  locale: Locale;
  sound: boolean;
  haptics: boolean;
  reminderEnabled: boolean;
  /** `HH:MM`, 24h. */
  reminderTime: string;
  displayName: string;
  updatedAt: string;
}

export interface AppData {
  version: typeof SCHEMA_VERSION;
  arc: StoredArc;
  habits: StoredHabit[];
  /** Keyed by `checkInKey(habitId, date)`. */
  checkIns: Record<string, CheckInRecord>;
  settings: Settings;
  /** Milestone days already celebrated for this arc. */
  celebratedMilestones: number[];
}

export const DEFAULT_REMINDER_TIME = "21:00";

export function checkInKey(habitId: string, date: ISODate): string {
  return `${habitId}|${date}`;
}

export function defaultSettings(locale: Locale, now: string): Settings {
  return {
    locale,
    sound: true,
    haptics: true,
    reminderEnabled: false,
    reminderTime: DEFAULT_REMINDER_TIME,
    displayName: "",
    updatedAt: now,
  };
}

export interface NewHabitInput {
  templateId?: HabitTemplateId;
  name: string;
  emoji: string;
}

export interface OnboardingInput {
  kind: ArcKind;
  window: { startDate: ISODate; endDate: ISODate };
  habits: NewHabitInput[];
  why: string;
  displayName: string;
  locale: Locale;
  /** Previous settings to keep (e.g. reminders) when starting a new arc. */
  settings?: Settings;
}

export function createAppData(input: OnboardingInput, now: string): AppData {
  const settings: Settings = {
    ...(input.settings ?? defaultSettings(input.locale, now)),
    locale: input.locale,
    displayName: input.displayName.trim(),
    updatedAt: now,
  };
  return {
    version: SCHEMA_VERSION,
    arc: {
      id: newId(),
      kind: input.kind,
      startDate: input.window.startDate,
      endDate: input.window.endDate,
      why: input.why.trim(),
      createdAt: now,
      updatedAt: now,
    },
    habits: input.habits.map((h, i) => makeHabit(h, i, now)),
    checkIns: {},
    settings,
    celebratedMilestones: [],
  };
}

function makeHabit(h: NewHabitInput, order: number, now: string): StoredHabit {
  return {
    id: newId(),
    ...(h.templateId ? { templateId: h.templateId } : {}),
    name: h.name.trim(),
    emoji: h.emoji.trim() || "🔥",
    order,
    createdAt: now,
    updatedAt: now,
  };
}

/** Habits that are not deleted, in display order. */
export function activeHabits(data: AppData): StoredHabit[] {
  return data.habits.filter((h) => !h.deletedAt).sort((a, b) => a.order - b.order);
}

export function isDone(data: AppData, habitId: string, date: ISODate): boolean {
  return data.checkIns[checkInKey(habitId, date)]?.done === true;
}

// ---- Reducers: pure, return a new AppData. ----

export function setCheckIn(data: AppData, habitId: string, date: ISODate, done: boolean, now: string): AppData {
  const key = checkInKey(habitId, date);
  return { ...data, checkIns: { ...data.checkIns, [key]: { habitId, date, done, updatedAt: now } } };
}

export function addHabit(data: AppData, input: NewHabitInput, now: string): AppData {
  const order = Math.max(-1, ...activeHabits(data).map((h) => h.order)) + 1;
  return { ...data, habits: [...data.habits, makeHabit(input, order, now)] };
}

export function updateHabit(
  data: AppData,
  habitId: string,
  patch: { name?: string; emoji?: string },
  now: string,
): AppData {
  return {
    ...data,
    habits: data.habits.map((h) => {
      if (h.id !== habitId) return h;
      const next: StoredHabit = { ...h, updatedAt: now };
      if (patch.emoji !== undefined) next.emoji = patch.emoji.trim() || h.emoji;
      if (patch.name !== undefined && patch.name.trim()) {
        next.name = patch.name.trim();
        // A renamed template habit keeps the custom name in every language.
        delete next.templateId;
      }
      return next;
    }),
  };
}

export function deleteHabit(data: AppData, habitId: string, now: string): AppData {
  return {
    ...data,
    habits: data.habits.map((h) => (h.id === habitId ? { ...h, deletedAt: now, updatedAt: now } : h)),
  };
}

/** Moves a habit up (-1) or down (+1) in the display order. */
export function moveHabit(data: AppData, habitId: string, direction: -1 | 1, now: string): AppData {
  const list = activeHabits(data);
  const from = list.findIndex((h) => h.id === habitId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= list.length) return data;
  const reordered = [...list];
  [reordered[from], reordered[to]] = [reordered[to]!, reordered[from]!];
  const newOrder = new Map(reordered.map((h, i) => [h.id, i]));
  return {
    ...data,
    habits: data.habits.map((h) => {
      const order = newOrder.get(h.id);
      return order === undefined || order === h.order ? h : { ...h, order, updatedAt: now };
    }),
  };
}

export function updateSettings(data: AppData, patch: Partial<Omit<Settings, "updatedAt">>, now: string): AppData {
  return { ...data, settings: { ...data.settings, ...patch, updatedAt: now } };
}

export function updateWhy(data: AppData, why: string, now: string): AppData {
  return { ...data, arc: { ...data.arc, why: why.trim(), updatedAt: now } };
}

export function markMilestonesCelebrated(data: AppData, days: readonly number[]): AppData {
  const set = new Set([...data.celebratedMilestones, ...days]);
  if (set.size === data.celebratedMilestones.length) return data;
  return { ...data, celebratedMilestones: [...set].sort((a, b) => a - b) };
}

// ---- Validation for data loaded from storage or an import. ----

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isStr = (v: unknown): v is string => typeof v === "string";
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Returns the data if it has the expected shape, otherwise `null` (treated as a fresh install). */
export function parseAppData(raw: unknown): AppData | null {
  if (!isObj(raw) || raw.version !== SCHEMA_VERSION) return null;
  const { arc, habits, checkIns, settings, celebratedMilestones } = raw;
  if (!isObj(arc) || !isStr(arc.id) || !isISODate(arc.startDate) || !isISODate(arc.endDate)) return null;
  if (arc.kind !== "winter" && arc.kind !== "custom") return null;
  if (!Array.isArray(habits) || !isObj(checkIns) || !isObj(settings)) return null;
  if (!habits.every((h) => isObj(h) && isStr(h.id) && isStr(h.name) && isStr(h.emoji) && typeof h.order === "number"))
    return null;
  for (const c of Object.values(checkIns)) {
    if (!isObj(c) || !isStr(c.habitId) || !isISODate(c.date) || typeof c.done !== "boolean") return null;
  }
  if (!isLocale(settings.locale)) return null;
  const reminderTime = isStr(settings.reminderTime) && TIME.test(settings.reminderTime)
    ? settings.reminderTime
    : DEFAULT_REMINDER_TIME;
  return {
    ...(raw as unknown as AppData),
    settings: { ...(settings as unknown as Settings), reminderTime },
    celebratedMilestones: Array.isArray(celebratedMilestones)
      ? celebratedMilestones.filter((n): n is number => typeof n === "number")
      : [],
  };
}
