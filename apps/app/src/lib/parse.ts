import { HABIT_TEMPLATES, isISODate, type HabitTemplateId } from "@cold-forge/core";
import { isLocale } from "@cold-forge/i18n";
import { isId } from "@cold-forge/sync";
import {
  DATA_LIMITS,
  DEFAULT_REMINDER_TIME,
  SCHEMA_VERSION,
  TEXT_LIMITS,
  checkInKey,
  type AppData,
  type CheckInRecord,
  type Settings,
  type StoredArc,
  type StoredHabit,
} from "./model.ts";
import { UNSAFE_TEXT, cleanText, codePointLength } from "./text.ts";

/**
 * Strict validation of AppData coming from outside the running app (device storage or an
 * imported file). Every field is copied explicitly into a fresh object, so unknown fields (and
 * keys like `__proto__`) never survive.
 *
 * - `import`: anything off is rejected — the user picked a file we don't trust.
 * - `storage`: our own data. Text that is merely too long or has invisible control characters is
 *   repaired instead of discarding the user's whole history; structural problems still reject.
 */
export type ParseMode = "storage" | "import";

export type ParseResult =
  | { ok: true; data: AppData; droppedCheckIns: number }
  | { ok: false; error: string };

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const TEMPLATE_IDS = new Set<string>(HABIT_TEMPLATES.map((t) => t.id));

class Invalid extends Error {}
const fail = (path: string, why: string): never => {
  throw new Invalid(`${path}: ${why}`);
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function text(v: unknown, path: string, max: number, mode: ParseMode, multiline = false): string {
  if (typeof v !== "string") return fail(path, "must be a string");
  if (mode === "storage") return cleanText(v, max, multiline);
  if (codePointLength(v) > max) return fail(path, `longer than ${max} characters`);
  if (UNSAFE_TEXT.test(v) || (!multiline && /[\n\t]/.test(v))) return fail(path, "contains control characters");
  return v;
}

function timestamp(v: unknown, path: string): string {
  if (typeof v !== "string" || !TIMESTAMP.test(v) || Number.isNaN(Date.parse(v))) {
    return fail(path, "must be an ISO UTC timestamp");
  }
  return v;
}

function id(v: unknown, path: string): string {
  return isId(v) ? v : fail(path, "invalid id");
}

function date(v: unknown, path: string): string {
  return isISODate(v) ? v : fail(path, "must be YYYY-MM-DD");
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function parseArc(v: unknown, mode: ParseMode): StoredArc {
  if (!isObj(v)) return fail("arc", "must be an object");
  const kind = v.kind === "winter" || v.kind === "custom" ? v.kind : fail("arc.kind", "invalid");
  const startDate = date(v.startDate, "arc.startDate");
  const endDate = date(v.endDate, "arc.endDate");
  if (startDate > endDate) fail("arc", "startDate after endDate");
  return {
    id: id(v.id, "arc.id"),
    kind,
    startDate,
    endDate,
    why: text(v.why ?? "", "arc.why", TEXT_LIMITS.why, mode, true),
    createdAt: timestamp(v.createdAt, "arc.createdAt"),
    updatedAt: timestamp(v.updatedAt, "arc.updatedAt"),
  };
}

function parseHabit(v: unknown, path: string, mode: ParseMode): StoredHabit {
  if (!isObj(v)) return fail(path, "must be an object");
  let templateId: HabitTemplateId | undefined;
  if (v.templateId !== undefined && v.templateId !== null) {
    if (typeof v.templateId !== "string" || !TEMPLATE_IDS.has(v.templateId)) fail(`${path}.templateId`, "unknown");
    templateId = v.templateId as HabitTemplateId;
  }
  if (typeof v.order !== "number" || !Number.isInteger(v.order) || v.order < 0 || v.order > 10_000) {
    fail(`${path}.order`, "must be a small non-negative integer");
  }
  const name = text(v.name, `${path}.name`, TEXT_LIMITS.name, mode);
  if (!name.trim() && !templateId) fail(`${path}.name`, "must not be empty");
  const emoji = text(v.emoji, `${path}.emoji`, TEXT_LIMITS.emoji, mode) || (mode === "storage" ? "🔥" : "");
  if (!emoji.trim()) fail(`${path}.emoji`, "must not be empty");
  const deletedAt = v.deletedAt === undefined || v.deletedAt === null ? undefined : timestamp(v.deletedAt, `${path}.deletedAt`);
  return {
    id: id(v.id, `${path}.id`),
    ...(templateId ? { templateId } : {}),
    name,
    emoji,
    order: v.order as number,
    createdAt: timestamp(v.createdAt, `${path}.createdAt`),
    updatedAt: timestamp(v.updatedAt, `${path}.updatedAt`),
    ...(deletedAt ? { deletedAt } : {}),
  };
}

function parseCheckIn(v: unknown, path: string): CheckInRecord {
  if (!isObj(v)) return fail(path, "must be an object");
  if (typeof v.done !== "boolean") fail(`${path}.done`, "must be a boolean");
  return {
    habitId: id(v.habitId, `${path}.habitId`),
    date: date(v.date, `${path}.date`),
    done: v.done as boolean,
    updatedAt: timestamp(v.updatedAt, `${path}.updatedAt`),
  };
}

function parseSettings(v: unknown, mode: ParseMode): Settings {
  if (!isObj(v)) return fail("settings", "must be an object");
  if (!isLocale(v.locale)) fail("settings.locale", "unsupported");
  const settings: Settings = {
    locale: v.locale as Settings["locale"],
    sound: bool(v.sound, true),
    haptics: bool(v.haptics, true),
    reminderEnabled: bool(v.reminderEnabled, false),
    reminderTime: typeof v.reminderTime === "string" && TIME.test(v.reminderTime) ? v.reminderTime : DEFAULT_REMINDER_TIME,
    displayName: text(v.displayName ?? "", "settings.displayName", TEXT_LIMITS.displayName, mode),
    updatedAt: timestamp(v.updatedAt, "settings.updatedAt"),
  };
  if (v.profileUpdatedAt !== undefined) settings.profileUpdatedAt = timestamp(v.profileUpdatedAt, "settings.profileUpdatedAt");
  return settings;
}

function parseMilestones(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const days = v
    .slice(0, DATA_LIMITS.milestones)
    .filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 400);
  return [...new Set(days)].sort((a, b) => a - b);
}

export function validateAppData(raw: unknown, mode: ParseMode): ParseResult {
  try {
    if (!isObj(raw)) return fail("data", "must be an object");
    if (raw.version !== SCHEMA_VERSION) fail("version", `must be ${SCHEMA_VERSION}`);
    const arc = parseArc(raw.arc, mode);

    if (!Array.isArray(raw.habits)) fail("habits", "must be an array");
    const rawHabits = raw.habits as unknown[];
    if (rawHabits.length > DATA_LIMITS.habits) fail("habits", `more than ${DATA_LIMITS.habits}`);
    const habits = rawHabits.map((h, i) => parseHabit(h, `habits[${i}]`, mode));
    const habitIds = new Set(habits.map((h) => h.id));
    if (habitIds.size !== habits.length) fail("habits", "duplicate ids");

    if (!isObj(raw.checkIns)) fail("checkIns", "must be an object");
    const rawCheckIns = Object.values(raw.checkIns as Record<string, unknown>);
    if (rawCheckIns.length > DATA_LIMITS.checkIns) fail("checkIns", `more than ${DATA_LIMITS.checkIns}`);
    // A null-prototype map while collecting, copied into a plain object at the end.
    const checkIns: Record<string, CheckInRecord> = Object.create(null) as Record<string, CheckInRecord>;
    let droppedCheckIns = 0;
    rawCheckIns.forEach((c, i) => {
      const rec = parseCheckIn(c, `checkIns[${i}]`);
      if (!habitIds.has(rec.habitId)) {
        droppedCheckIns++;
        return;
      }
      const key = checkInKey(rec.habitId, rec.date);
      const prev = checkIns[key];
      if (!prev || Date.parse(rec.updatedAt) > Date.parse(prev.updatedAt)) checkIns[key] = rec;
    });

    const data: AppData = {
      version: SCHEMA_VERSION,
      arc,
      habits,
      checkIns: { ...checkIns },
      settings: parseSettings(raw.settings, mode),
      celebratedMilestones: parseMilestones(raw.celebratedMilestones),
    };
    return { ok: true, data, droppedCheckIns };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    throw e;
  }
}

/** Returns the data if it has the expected shape, otherwise `null` (treated as a fresh install). */
export function parseAppData(raw: unknown, mode: ParseMode = "storage"): AppData | null {
  const r = validateAppData(raw, mode);
  return r.ok ? r.data : null;
}
