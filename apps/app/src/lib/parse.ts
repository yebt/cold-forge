import { HABIT_TEMPLATES, isISODate, type HabitTemplateId } from "@cold-forge/core";
import { isLocale } from "@cold-forge/i18n";
import { canonicalTimestamp, isEmoji, isId } from "@cold-forge/sync";
import { FALLBACK_EMOJI, repairHabitName, repairText, type TextField } from "./fields.ts";
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
import { codePointLength } from "./text.ts";

/**
 * Strict validation of AppData coming from outside the running app (device storage or an
 * imported file). Every field is copied explicitly into a fresh object, so unknown fields (and
 * keys like `__proto__`) never survive. Structural problems (ids, dates, timestamps, shapes,
 * counts) always reject.
 *
 * Text and emoji are *repaired* into what the sync API accepts — invisible/bidi/control
 * characters stripped, invalid emoji -> 🔥, blank custom names -> "Habit" — and every repaired
 * record gets `updatedAt = now` so the fix syncs. Otherwise one bad value would make every sync
 * fail with 400 invalid_request forever.
 *
 * - `import`: over-long text is still rejected (a genuine export can't contain it).
 * - `storage`: our own data; over-long text is truncated rather than losing the user's history.
 */
export type ParseMode = "storage" | "import";

export type ParseResult =
  | { ok: true; data: AppData; droppedCheckIns: number; repaired: number }
  | { ok: false; error: string };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const TEMPLATE_IDS = new Set<string>(HABIT_TEMPLATES.map((t) => t.id));

class Invalid extends Error {}
const fail = (path: string, why: string): never => {
  throw new Invalid(`${path}: ${why}`);
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Per-record repair bookkeeping. */
interface Ctx {
  mode: ParseMode;
  now: string;
  repaired: boolean;
}

const MAX: Record<TextField, number> = { name: TEXT_LIMITS.name, why: TEXT_LIMITS.why, displayName: TEXT_LIMITS.displayName };

function text(v: unknown, path: string, field: TextField, ctx: Ctx): string {
  if (typeof v !== "string") return fail(path, "must be a string");
  if (ctx.mode === "import" && codePointLength(v) > MAX[field]) return fail(path, `longer than ${MAX[field]} characters`);
  if (v.length > 10_000) return fail(path, "far too long");
  const fixed = repairText(field, v);
  if (fixed !== v) ctx.repaired = true;
  return fixed;
}

function timestamp(v: unknown, path: string): string {
  return canonicalTimestamp(v) ?? fail(path, "must be an ISO UTC timestamp");
}

const fresh = (mode: ParseMode, now: string): Ctx => ({ mode, now, repaired: false });

function id(v: unknown, path: string): string {
  return isId(v) ? v : fail(path, "invalid id");
}

function date(v: unknown, path: string): string {
  return isISODate(v) ? v : fail(path, "must be YYYY-MM-DD");
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function parseArc(v: unknown, ctx: Ctx): StoredArc {
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
    why: text(v.why ?? "", "arc.why", "why", ctx),
    createdAt: timestamp(v.createdAt, "arc.createdAt"),
    updatedAt: ctx.repaired ? ctx.now : timestamp(v.updatedAt, "arc.updatedAt"),
  };
}

function parseHabit(v: unknown, path: string, ctx: Ctx): StoredHabit {
  if (!isObj(v)) return fail(path, "must be an object");
  let templateId: HabitTemplateId | undefined;
  if (v.templateId !== undefined && v.templateId !== null) {
    if (typeof v.templateId !== "string" || !TEMPLATE_IDS.has(v.templateId)) fail(`${path}.templateId`, "unknown");
    templateId = v.templateId as HabitTemplateId;
  }
  if (typeof v.order !== "number" || !Number.isInteger(v.order) || v.order < 0 || v.order > 10_000) {
    fail(`${path}.order`, "must be a small non-negative integer");
  }
  const cleaned = text(v.name, `${path}.name`, "name", ctx);
  const name = repairHabitName(cleaned, !!templateId);
  if (name !== cleaned) ctx.repaired = true;
  if (typeof v.emoji !== "string" || v.emoji.length > 1000) fail(`${path}.emoji`, "must be a string");
  let emoji = v.emoji as string;
  if (!isEmoji(emoji)) {
    emoji = FALLBACK_EMOJI;
    ctx.repaired = true;
  }
  const deletedAt = v.deletedAt === undefined || v.deletedAt === null ? undefined : timestamp(v.deletedAt, `${path}.deletedAt`);
  return {
    id: id(v.id, `${path}.id`),
    ...(templateId ? { templateId } : {}),
    name,
    emoji,
    order: v.order as number,
    createdAt: timestamp(v.createdAt, `${path}.createdAt`),
    updatedAt: ctx.repaired ? ctx.now : timestamp(v.updatedAt, `${path}.updatedAt`),
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

function parseSettings(v: unknown, ctx: Ctx): Settings {
  if (!isObj(v)) return fail("settings", "must be an object");
  if (!isLocale(v.locale)) fail("settings.locale", "unsupported");
  const settings: Settings = {
    locale: v.locale as Settings["locale"],
    sound: bool(v.sound, true),
    haptics: bool(v.haptics, true),
    reminderEnabled: bool(v.reminderEnabled, false),
    reminderTime: typeof v.reminderTime === "string" && TIME.test(v.reminderTime) ? v.reminderTime : DEFAULT_REMINDER_TIME,
    displayName: text(v.displayName ?? "", "settings.displayName", "displayName", ctx),
    updatedAt: timestamp(v.updatedAt, "settings.updatedAt"),
  };
  if (v.profileUpdatedAt !== undefined) settings.profileUpdatedAt = timestamp(v.profileUpdatedAt, "settings.profileUpdatedAt");
  if (ctx.repaired) {
    settings.updatedAt = ctx.now;
    settings.profileUpdatedAt = ctx.now;
  }
  return settings;
}

function parseMilestones(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const days = v
    .slice(0, DATA_LIMITS.milestones)
    .filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 400);
  return [...new Set(days)].sort((a, b) => a - b);
}

export function validateAppData(raw: unknown, mode: ParseMode, now = new Date().toISOString()): ParseResult {
  try {
    if (!isObj(raw)) return fail("data", "must be an object");
    if (raw.version !== SCHEMA_VERSION) fail("version", `must be ${SCHEMA_VERSION}`);
    let repaired = 0;
    const count = <T>(ctx: Ctx, value: T): T => {
      if (ctx.repaired) repaired++;
      return value;
    };
    const arcCtx = fresh(mode, now);
    const arc = count(arcCtx, parseArc(raw.arc, arcCtx));

    if (!Array.isArray(raw.habits)) fail("habits", "must be an array");
    const rawHabits = raw.habits as unknown[];
    if (rawHabits.length > DATA_LIMITS.habits) fail("habits", `more than ${DATA_LIMITS.habits}`);
    const habits = rawHabits.map((h, i) => {
      const ctx = fresh(mode, now);
      return count(ctx, parseHabit(h, `habits[${i}]`, ctx));
    });
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
      settings: (() => {
        const ctx = fresh(mode, now);
        return count(ctx, parseSettings(raw.settings, ctx));
      })(),
      celebratedMilestones: parseMilestones(raw.celebratedMilestones),
    };
    return { ok: true, data, droppedCheckIns, repaired };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    throw e;
  }
}

/** Returns the data if it has the expected shape, otherwise `null` (treated as a fresh install). */
export function parseAppData(raw: unknown, mode: ParseMode = "storage", now?: string): AppData | null {
  const r = validateAppData(raw, mode, now);
  return r.ok ? r.data : null;
}
