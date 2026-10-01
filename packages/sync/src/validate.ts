import { HABIT_TEMPLATES, isISODate } from "@cold-forge/core";
import { isLocale } from "@cold-forge/i18n";
import {
  SYNC_PROTOCOL_VERSION,
  type MagicLinkRequest,
  type SyncArc,
  type SyncChanges,
  type SyncCheckIn,
  type SyncHabit,
  type SyncProfile,
  type SyncRequest,
  type VerifyRequest,
} from "./types.ts";

/** Hard limits. Anything over them is rejected, not truncated, so bad clients fail loudly. */
export const LIMITS = {
  maxBodyBytes: 1_000_000,
  maxArcsPerRequest: 20,
  maxHabitsPerRequest: 200,
  maxCheckInsPerRequest: 5_000,
  nameLength: 60,
  whyLength: 280,
  displayNameLength: 40,
  emojiLength: 16,
  emailLength: 254,
  /** How far into the future a client timestamp may be before it is rejected. */
  maxClockSkewMs: 5 * 60_000,
} as const;

/** Per-user storage caps enforced by the server (tombstones count). */
export const QUOTAS = {
  arcs: 50,
  habits: 500,
  checkIns: 50_000,
} as const;

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const CODE = /^\d{6}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
// Pragmatic: one @, no spaces/control chars, a dot in the domain. Real verification is the email itself.
const EMAIL = /^[^\s@\x00-\x1f\x7f<>()[\]\\,;:"]+@[^\s@\x00-\x1f\x7f<>()[\]\\,;:"]+\.[^\s@\x00-\x1f\x7f<>()[\]\\,;:"]+$/;
const TEMPLATE_IDS = new Set<string>(HABIT_TEMPLATES.map((t) => t.id));
// C0/C1 control characters and bidi overrides have no business in names and enable spoofing.
const UNSAFE_TEXT = /[\x00-\x08\x0b-\x1f\x7f-\x9f‪-‮⁦-⁩]/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

class Invalid extends Error {}
const fail = (path: string, why: string): never => {
  throw new Invalid(`${path}: ${why}`);
};

function text(v: unknown, path: string, max: number, { allowEmpty = true, multiline = false } = {}): string {
  if (typeof v !== "string") return fail(path, "must be a string");
  if ([...v].length > max) return fail(path, `longer than ${max} characters`);
  if (UNSAFE_TEXT.test(v) || (!multiline && /[\n\t]/.test(v))) return fail(path, "contains control characters");
  if (!allowEmpty && !v.trim()) return fail(path, "must not be empty");
  return v;
}

export function isId(v: unknown): v is string {
  return typeof v === "string" && ID.test(v);
}

function id(v: unknown, path: string): string {
  return isId(v) ? v : fail(path, "invalid id");
}

function date(v: unknown, path: string) {
  return isISODate(v) ? v : fail(path, "must be YYYY-MM-DD");
}

function timestamp(v: unknown, path: string, now: number): string {
  if (typeof v !== "string" || !TIMESTAMP.test(v) || Number.isNaN(Date.parse(v))) {
    return fail(path, "must be an ISO UTC timestamp");
  }
  // A far-future timestamp would win every last-write-wins merge forever.
  if (Date.parse(v) > now + LIMITS.maxClockSkewMs) return fail(path, "is in the future");
  return v;
}

function optionalTimestamp(v: unknown, path: string, now: number): string | undefined {
  return v === undefined || v === null ? undefined : timestamp(v, path, now);
}

function list(v: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(v)) return fail(path, "must be an array");
  if (v.length > max) return fail(path, `more than ${max} items`);
  return v;
}

function arc(v: unknown, path: string, now: number): SyncArc {
  if (!isObj(v)) return fail(path, "must be an object");
  const kind = v.kind === "winter" || v.kind === "custom" ? v.kind : fail(`${path}.kind`, "invalid");
  const startDate = date(v.startDate, `${path}.startDate`);
  const endDate = date(v.endDate, `${path}.endDate`);
  if (startDate > endDate) fail(path, "startDate after endDate");
  const deletedAt = optionalTimestamp(v.deletedAt, `${path}.deletedAt`, now);
  return {
    id: id(v.id, `${path}.id`),
    kind,
    startDate,
    endDate,
    why: text(v.why, `${path}.why`, LIMITS.whyLength, { multiline: true }),
    createdAt: timestamp(v.createdAt, `${path}.createdAt`, now),
    updatedAt: timestamp(v.updatedAt, `${path}.updatedAt`, now),
    ...(deletedAt ? { deletedAt } : {}),
  };
}

function habit(v: unknown, path: string, now: number): SyncHabit {
  if (!isObj(v)) return fail(path, "must be an object");
  if (v.templateId !== undefined && v.templateId !== null && !TEMPLATE_IDS.has(v.templateId as string)) {
    fail(`${path}.templateId`, "unknown template");
  }
  if (typeof v.order !== "number" || !Number.isInteger(v.order) || v.order < 0 || v.order > 10_000) {
    fail(`${path}.order`, "must be a small non-negative integer");
  }
  const deletedAt = optionalTimestamp(v.deletedAt, `${path}.deletedAt`, now);
  return {
    id: id(v.id, `${path}.id`),
    arcId: id(v.arcId, `${path}.arcId`),
    ...(typeof v.templateId === "string" ? { templateId: v.templateId as SyncHabit["templateId"] & string } : {}),
    name: text(v.name, `${path}.name`, LIMITS.nameLength, { allowEmpty: typeof v.templateId === "string" }),
    emoji: text(v.emoji, `${path}.emoji`, LIMITS.emojiLength, { allowEmpty: false }),
    order: v.order as number,
    createdAt: timestamp(v.createdAt, `${path}.createdAt`, now),
    updatedAt: timestamp(v.updatedAt, `${path}.updatedAt`, now),
    ...(deletedAt ? { deletedAt } : {}),
  };
}

function checkIn(v: unknown, path: string, now: number): SyncCheckIn {
  if (!isObj(v)) return fail(path, "must be an object");
  if (typeof v.done !== "boolean") fail(`${path}.done`, "must be a boolean");
  return {
    habitId: id(v.habitId, `${path}.habitId`),
    date: date(v.date, `${path}.date`),
    done: v.done as boolean,
    updatedAt: timestamp(v.updatedAt, `${path}.updatedAt`, now),
  };
}

function profile(v: unknown, path: string, now: number): SyncProfile | null {
  if (v === null || v === undefined) return null;
  if (!isObj(v)) return fail(path, "must be an object");
  return {
    displayName: text(v.displayName, `${path}.displayName`, LIMITS.displayNameLength),
    locale: isLocale(v.locale) ? v.locale : fail(`${path}.locale`, "unsupported locale"),
    currentArcId: v.currentArcId === null ? null : id(v.currentArcId, `${path}.currentArcId`),
    updatedAt: timestamp(v.updatedAt, `${path}.updatedAt`, now),
  };
}

function changes(v: unknown, path: string, now: number): SyncChanges {
  if (!isObj(v)) return fail(path, "must be an object");
  return {
    arcs: list(v.arcs, `${path}.arcs`, LIMITS.maxArcsPerRequest).map((a, i) => arc(a, `${path}.arcs[${i}]`, now)),
    habits: list(v.habits, `${path}.habits`, LIMITS.maxHabitsPerRequest).map((h, i) =>
      habit(h, `${path}.habits[${i}]`, now),
    ),
    checkIns: list(v.checkIns, `${path}.checkIns`, LIMITS.maxCheckInsPerRequest).map((c, i) =>
      checkIn(c, `${path}.checkIns[${i}]`, now),
    ),
    profile: profile(v.profile, `${path}.profile`, now),
  };
}

function guard<T>(fn: () => T): Result<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    throw e;
  }
}

/** Strict validation of an untrusted sync body. Unknown fields are dropped. */
export function parseSyncRequest(raw: unknown, now = Date.now()): Result<SyncRequest> {
  return guard(() => {
    if (!isObj(raw)) return fail("body", "must be an object");
    if (raw.protocol !== SYNC_PROTOCOL_VERSION) fail("protocol", `must be ${SYNC_PROTOCOL_VERSION}`);
    const cursor = raw.cursor === null ? null : text(raw.cursor, "cursor", 64, { allowEmpty: false });
    return { protocol: SYNC_PROTOCOL_VERSION, cursor, changes: changes(raw.changes, "changes", now) };
  });
}

/** Lowercased, trimmed email, or an error. */
export function normalizeEmail(raw: unknown): Result<string> {
  return guard(() => {
    if (typeof raw !== "string") return fail("email", "must be a string");
    const email = raw.trim().toLowerCase();
    if (email.length > LIMITS.emailLength || !EMAIL.test(email)) return fail("email", "invalid");
    return email;
  });
}

export function parseMagicLinkRequest(raw: unknown): Result<MagicLinkRequest> {
  return guard(() => {
    if (!isObj(raw)) return fail("body", "must be an object");
    const email = normalizeEmail(raw.email);
    if (!email.ok) return fail("email", "invalid");
    return { email: email.value, locale: isLocale(raw.locale) ? raw.locale : "en" };
  });
}

export function parseVerifyRequest(raw: unknown): Result<VerifyRequest> {
  return guard(() => {
    if (!isObj(raw)) return fail("body", "must be an object");
    if (typeof raw.token === "string") {
      return TOKEN.test(raw.token) ? { token: raw.token } : fail("token", "invalid");
    }
    const requestId = id(raw.requestId, "requestId");
    const code = typeof raw.code === "string" && CODE.test(raw.code) ? raw.code : fail("code", "must be 6 digits");
    return { requestId, code };
  });
}
