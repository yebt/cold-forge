import { HABIT_TEMPLATES, diffDays, isISODate, parseISODate } from "@cold-forge/core";
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

/**
 * Hard limits. Anything over them is rejected, not truncated, so bad clients fail loudly.
 *
 * Text lengths count UTF-16 code units (`string.length`), which is what Firestore rules'
 * `string.size()` counts too, so the client and firebase/firestore.rules agree on every string
 * (30 × "💪" = 60 units fits a name; 31 doesn't).
 */
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
  emailLocalLength: 64,
  /** How far into the future a client timestamp may be before it is rejected. */
  maxClockSkewMs: 5 * 60_000,
} as const;

/**
 * Bounds on the key space and timestamps of what may be WRITTEN (firebase/firestore.rules enforces
 * the same numbers). They cap how many distinct documents one account can create and stop
 * nonsense dates (year 0001 or 9999) from ever reaching the server.
 *
 * - Every timestamp (createdAt, updatedAt, deletedAt) is >= `minTimestamp`, and createdAt <= updatedAt.
 * - An arc starts on or after `minDate` and spans at most `maxArcDays` days (inclusive).
 * - A check-in's date lies within [now - checkInPastDays, now + checkInFutureDays] (UTC midnight
 *   of the date vs the server clock). Older check-ins (e.g. imported from an old export) stay on
 *   the device and are simply never pushed: the outgoing pre-validator holds them back.
 *
 * They apply to writes only (`parseSyncRequest(..., { bounds: true })`, the default). Data read
 * back from the server or from device storage is parsed with `bounds: false`: a check-in that was
 * fine when written must not become "invalid" a year later.
 */
export const WRITE_BOUNDS = {
  minDate: "2024-01-01",
  minTimestamp: "2024-01-01T00:00:00.000Z",
  maxArcDays: 366,
  checkInPastDays: 400,
  checkInFutureDays: 2,
} as const;

export { QUOTAS } from "./quotas.ts";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/;
const CODE = /^\d{6}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const TEMPLATE_IDS = new Set<string>(HABIT_TEMPLATES.map((t) => t.id));

/**
 * Characters that have no business in user text and enable spoofing or smuggling:
 * C0/C1 controls (tab/newline handled separately), soft hyphen, zero-width space/joiners and
 * directional marks (U+200B–U+200F), line/paragraph separators and bidi embeddings/overrides
 * (U+2028–U+202E), word joiner and invisible operators (U+2060–U+2064), bidi isolates
 * (U+2066–U+2069), BOM/ZWNBSP (U+FEFF), Arabic letter mark (U+061C), Mongolian vowel separator
 * (U+180E) and Unicode tag characters (U+E0000–U+E007F).
 */
const UNSAFE_TEXT =
  /[\x00-\x08\x0b-\x1f\x7f-\x9f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u{e0000}-\u{e007f}]/u;
/** The same set minus what legitimately builds emoji sequences: ZWJ (U+200D) and tag characters. */
const UNSAFE_EMOJI =
  /[\x00-\x1f\x7f-\x9f\u00ad\u061c\u180e\u200b\u200c\u200e\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u{e0000}-\u{e001f}\u{e0080}-\u{e00ff}]/u;
/** Subdivision flags (🏴 + lowercase tag letters + CANCEL TAG) are the only place tag characters may appear. */
const TAG_FLAG = /\u{1f3f4}[\u{e0030}-\u{e0039}\u{e0061}-\u{e007a}]{1,6}\u{e007f}/gu;
const TAG_CHAR = /[\u{e0000}-\u{e007f}]/u;
/** "Zalgo" text: long stacks of combining marks. */
const COMBINING_RUN = /\p{M}{4,}/u;
/** Must start with a pictograph, a regional indicator (flags) or be a keycap (1️⃣ #️⃣ *️⃣). */
const EMOJI_START = /^\p{Extended_Pictographic}|^\p{Regional_Indicator}|^[0-9#*]\ufe0f?\u20e3/u;
const MAX_EMOJI_GRAPHEMES = 2;
/**
 * Exactly the code points the Firestore rules accept in an emoji (explicit ranges, see
 * firebase/firestore.rules `isEmoji`): emoji pictographs (incl. regional indicators and skin
 * tones), keycaps, ZWJ, VS16 and subdivision-flag tag sequences. No ASCII letters, spaces or `<>`.
 */
const EMOJI_PICTO =
  "\\u00a9\\u00ae\\u203c\\u2049\\u2122\\u2139\\u2194-\\u2199\\u21a9\\u21aa\\u231a\\u231b\\u2328\\u23cf\\u23e9-\\u23f3\\u23f8-\\u23fa\\u24c2\\u25aa\\u25ab\\u25b6\\u25c0\\u25fb-\\u25fe\\u2600-\\u27bf\\u2934\\u2935\\u2b05-\\u2b07\\u2b1b\\u2b1c\\u2b50\\u2b55\\u3030\\u303d\\u3297\\u3299\\u{1f000}-\\u{1faff}";
const EMOJI_UNIT = `[${EMOJI_PICTO}]|[0-9#*]\\ufe0f?\\u20e3|\\u{1f3f4}[\\u{e0030}-\\u{e0039}\\u{e0061}-\\u{e007a}]{1,6}\\u{e007f}`;
export const EMOJI_STRICT = new RegExp(`^(?:${EMOJI_UNIT})(?:${EMOJI_UNIT}|[\\u200d\\ufe0f])*$`, "u");
/** Invisible or blank-rendering code points that must not make a "non-empty" value. */
const INVISIBLE =
  /[\s\p{M}\p{Cf}\p{Default_Ignorable_Code_Point}\u2800\u3164\u115f\u1160\uffa0\u{e0000}-\u{e007f}]/gu;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

class Invalid extends Error {}
const fail = (path: string, why: string): never => {
  throw new Invalid(`${path}: ${why}`);
};

/**
 * True if the string renders as nothing (only whitespace, marks and invisible format characters).
 * `\s` in JS covers every Unicode space separator (NBSP, U+3000, U+2000–U+200A…), like `\p{Z}` in the rules.
 */
export function isBlank(v: string): boolean {
  return v.replace(INVISIBLE, "").length === 0;
}

/**
 * `allowEmpty`: "" is accepted. A value that is not empty but renders as nothing (only spaces,
 * NBSP, U+3000, invisibles…) is rejected unless `allowBlank` (free text like "why").
 */
function text(
  v: unknown,
  path: string,
  max: number,
  { allowEmpty = true, allowBlank = false, multiline = false } = {},
): string {
  if (typeof v !== "string") return fail(path, "must be a string");
  // Lone surrogates cannot be stored as UTF-8 faithfully (SQLite/Buffer would mangle them).
  if (!v.isWellFormed()) return fail(path, "is not well-formed Unicode");
  // UTF-16 code units, like the Firestore rules' string.size().
  if (v.length > max) return fail(path, `longer than ${max} characters`);
  if (UNSAFE_TEXT.test(v) || (!multiline && /[\n\t]/.test(v))) return fail(path, "contains control characters");
  if (COMBINING_RUN.test(v)) return fail(path, "contains too many combining marks");
  if (v === "" ? !allowEmpty : !allowBlank && isBlank(v)) return fail(path, "must not be empty");
  return v;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** A habit emoji: one or two emoji graphemes. ZWJ sequences, variation selectors, skin tones and flags are fine. */
export function isEmoji(v: unknown): v is string {
  if (typeof v !== "string" || !v.isWellFormed() || v.length === 0) return false;
  if (v.length > LIMITS.emojiLength) return false;
  if (UNSAFE_EMOJI.test(v) || TAG_CHAR.test(v.replace(TAG_FLAG, ""))) return false;
  if (COMBINING_RUN.test(v) || !EMOJI_START.test(v) || !EMOJI_STRICT.test(v)) return false;
  let count = 0;
  for (const _ of graphemes.segment(v)) if (++count > MAX_EMOJI_GRAPHEMES) return false;
  return true;
}

function emoji(v: unknown, path: string): string {
  return isEmoji(v) ? v : fail(path, "must be one or two emoji");
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

/**
 * Canonical ISO UTC timestamp with exactly 3 fractional digits, or null. Accepts 0–3 digits and
 * requires a real round trip, so impossible values (02-30, 24:00, :60) are rejected rather than
 * silently rolled over by Date.parse.
 */
export function canonicalTimestamp(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = TIMESTAMP.exec(v);
  if (!m) return null;
  const canonical = `${m[1]}.${(m[2] ?? "").padEnd(3, "0")}Z`;
  const ms = Date.parse(canonical);
  if (Number.isNaN(ms) || new Date(ms).toISOString() !== canonical) return null;
  return canonical;
}

function timestamp(v: unknown, path: string, now: number): string {
  const canonical = canonicalTimestamp(v);
  if (canonical === null) return fail(path, "must be an ISO UTC timestamp");
  // A far-future timestamp would win every last-write-wins merge forever.
  if (Date.parse(canonical) > now + LIMITS.maxClockSkewMs) return fail(path, "is in the future");
  return canonical;
}

function optionalTimestamp(v: unknown, path: string, now: number): string | undefined {
  return v === undefined || v === null ? undefined : timestamp(v, path, now);
}

/** Options of `parseSyncRequest`. */
export interface ParseOptions {
  /** Enforce `WRITE_BOUNDS` (default true). Off for data read back from the server or storage. */
  bounds?: boolean;
}

interface Ctx {
  now: number;
  bounds: boolean;
}

/** Is `date` inside the window the rules accept for a check-in written at `now`? */
export function checkInDateWritable(date: string, now: number): boolean {
  const t = parseISODate(date);
  return t >= now - WRITE_BOUNDS.checkInPastDays * DAY_MS && t <= now + WRITE_BOUNDS.checkInFutureDays * DAY_MS;
}

const DAY_MS = 86_400_000;

function bounded(ctx: Ctx, path: string, times: { createdAt?: string; updatedAt: string; deletedAt?: string }): void {
  if (!ctx.bounds) return;
  for (const k of ["createdAt", "updatedAt", "deletedAt"] as const) {
    const t = times[k];
    if (t !== undefined && t < WRITE_BOUNDS.minTimestamp) fail(`${path}.${k}`, "is too old");
  }
  if (times.createdAt !== undefined && times.createdAt > times.updatedAt) fail(`${path}.createdAt`, "is after updatedAt");
}

function list(v: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(v)) return fail(path, "must be an array");
  if (v.length > max) return fail(path, `more than ${max} items`);
  return v;
}

function arc(v: unknown, path: string, ctx: Ctx): SyncArc {
  const { now } = ctx;
  if (!isObj(v)) return fail(path, "must be an object");
  const kind = v.kind === "winter" || v.kind === "custom" ? v.kind : fail(`${path}.kind`, "invalid");
  const startDate = date(v.startDate, `${path}.startDate`);
  const endDate = date(v.endDate, `${path}.endDate`);
  if (startDate > endDate) fail(path, "startDate after endDate");
  if (ctx.bounds) {
    if (startDate < WRITE_BOUNDS.minDate) fail(`${path}.startDate`, "is too old");
    if (diffDays(startDate, endDate) + 1 > WRITE_BOUNDS.maxArcDays) fail(path, `longer than ${WRITE_BOUNDS.maxArcDays} days`);
  }
  const deletedAt = optionalTimestamp(v.deletedAt, `${path}.deletedAt`, now);
  const out: SyncArc = {
    id: id(v.id, `${path}.id`),
    kind,
    startDate,
    endDate,
    why: text(v.why, `${path}.why`, LIMITS.whyLength, { multiline: true, allowBlank: true }),
    createdAt: timestamp(v.createdAt, `${path}.createdAt`, now),
    updatedAt: timestamp(v.updatedAt, `${path}.updatedAt`, now),
    ...(deletedAt ? { deletedAt } : {}),
  };
  bounded(ctx, path, out);
  return out;
}

function habit(v: unknown, path: string, ctx: Ctx): SyncHabit {
  const { now } = ctx;
  if (!isObj(v)) return fail(path, "must be an object");
  if (v.templateId !== undefined && v.templateId !== null && !TEMPLATE_IDS.has(v.templateId as string)) {
    fail(`${path}.templateId`, "unknown template");
  }
  if (typeof v.order !== "number" || !Number.isInteger(v.order) || v.order < 0 || v.order > 10_000) {
    fail(`${path}.order`, "must be a small non-negative integer");
  }
  const deletedAt = optionalTimestamp(v.deletedAt, `${path}.deletedAt`, now);
  const out: SyncHabit = {
    id: id(v.id, `${path}.id`),
    arcId: id(v.arcId, `${path}.arcId`),
    ...(typeof v.templateId === "string" ? { templateId: v.templateId as SyncHabit["templateId"] & string } : {}),
    name: text(v.name, `${path}.name`, LIMITS.nameLength, { allowEmpty: typeof v.templateId === "string" }),
    emoji: emoji(v.emoji, `${path}.emoji`),
    order: v.order as number,
    createdAt: timestamp(v.createdAt, `${path}.createdAt`, now),
    updatedAt: timestamp(v.updatedAt, `${path}.updatedAt`, now),
    ...(deletedAt ? { deletedAt } : {}),
  };
  bounded(ctx, path, out);
  return out;
}

function checkIn(v: unknown, path: string, ctx: Ctx): SyncCheckIn {
  if (!isObj(v)) return fail(path, "must be an object");
  if (typeof v.done !== "boolean") fail(`${path}.done`, "must be a boolean");
  const out: SyncCheckIn = {
    habitId: id(v.habitId, `${path}.habitId`),
    date: date(v.date, `${path}.date`),
    done: v.done as boolean,
    updatedAt: timestamp(v.updatedAt, `${path}.updatedAt`, ctx.now),
  };
  if (ctx.bounds && !checkInDateWritable(out.date, ctx.now)) fail(`${path}.date`, "is outside the writable window");
  bounded(ctx, path, out);
  return out;
}

function profile(v: unknown, path: string, ctx: Ctx): SyncProfile | null {
  if (v === null || v === undefined) return null;
  if (!isObj(v)) return fail(path, "must be an object");
  const out: SyncProfile = {
    displayName: text(v.displayName, `${path}.displayName`, LIMITS.displayNameLength),
    locale: isLocale(v.locale) ? v.locale : fail(`${path}.locale`, "unsupported locale"),
    currentArcId: v.currentArcId === null ? null : id(v.currentArcId, `${path}.currentArcId`),
    updatedAt: timestamp(v.updatedAt, `${path}.updatedAt`, ctx.now),
  };
  bounded(ctx, path, out);
  return out;
}

function changes(v: unknown, path: string, ctx: Ctx): SyncChanges {
  if (!isObj(v)) return fail(path, "must be an object");
  return {
    arcs: list(v.arcs, `${path}.arcs`, LIMITS.maxArcsPerRequest).map((a, i) => arc(a, `${path}.arcs[${i}]`, ctx)),
    habits: list(v.habits, `${path}.habits`, LIMITS.maxHabitsPerRequest).map((h, i) =>
      habit(h, `${path}.habits[${i}]`, ctx),
    ),
    checkIns: list(v.checkIns, `${path}.checkIns`, LIMITS.maxCheckInsPerRequest).map((c, i) =>
      checkIn(c, `${path}.checkIns[${i}]`, ctx),
    ),
    profile: profile(v.profile, `${path}.profile`, ctx),
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

/**
 * Strict validation of an untrusted sync body. Unknown fields are dropped. `bounds` (default on)
 * adds the write-time `WRITE_BOUNDS`; turn it off only for data read back from the server/storage.
 */
export function parseSyncRequest(raw: unknown, now = Date.now(), opts: ParseOptions = {}): Result<SyncRequest> {
  const ctx: Ctx = { now, bounds: opts.bounds ?? true };
  return guard(() => {
    if (!isObj(raw)) return fail("body", "must be an object");
    if (raw.protocol !== SYNC_PROTOCOL_VERSION) fail("protocol", `must be ${SYNC_PROTOCOL_VERSION}`);
    // text() also rejects lone surrogates and invisible characters in the cursor.
    const cursor = raw.cursor === null ? null : text(raw.cursor, "cursor", 64, { allowEmpty: false });
    return { protocol: SYNC_PROTOCOL_VERSION, cursor, changes: changes(raw.changes, "changes", ctx) };
  });
}

// RFC 5322 dot-atom text, ASCII only. Quoted local parts and SMTPUTF8 are deliberately unsupported:
// what we store must be exactly what the SMTP envelope carries.
const EMAIL_LOCAL = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+$/;
// Before IDNA: ASCII is limited to LDH and dots; non-ASCII may not be invisible, format, space or control.
const DOMAIN_ASCII_UNSAFE = /[\x00-\x2c\x2f\x3a-\x40\x5b-\x60\x7b-\x7f]/;
const DOMAIN_UNICODE_UNSAFE = /[\p{Cc}\p{Cf}\p{Z}\p{Co}\p{Cn}\p{Default_Ignorable_Code_Point}]/u;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX_EMAIL_INPUT = 1024; // bound the work done on hostile input before any parsing

/** IDNA (UTS #46, via the WHATWG URL parser) → lowercase ASCII hostname, or null if it is not a valid DNS name. */
function asciiDomain(raw: string): string | null {
  if (!raw || DOMAIN_ASCII_UNSAFE.test(raw) || DOMAIN_UNICODE_UNSAFE.test(raw)) return null;
  let host: string;
  try {
    host = new URL(`http://${raw}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host.length > 253 || host.endsWith(".")) return null;
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return null;
  // An all-numeric TLD means an IP literal (URL turns "0x7f.1" into "127.0.0.1").
  if (/^\d+$/.test(labels.at(-1)!)) return null;
  return host;
}

/**
 * Canonical email: NFC, ASCII local part (lowercased), domain converted to lowercase ASCII
 * (punycode). This exact string is what is stored, compared, rate limited and handed to SMTP,
 * so two inputs that reach the same mailbox through the same envelope normalize to one value.
 */
export function normalizeEmail(raw: unknown): Result<string> {
  return guard(() => {
    if (typeof raw !== "string" || raw.length > MAX_EMAIL_INPUT) return fail("email", "invalid");
    if (!raw.isWellFormed()) return fail("email", "invalid");
    // Only ASCII whitespace is trimmed (copy/paste); String#trim would also eat U+FEFF and friends.
    const s = raw.normalize("NFC").replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
    const at = s.indexOf("@");
    if (at < 1 || at !== s.lastIndexOf("@")) return fail("email", "invalid");
    const local = s.slice(0, at);
    if (
      local.length > LIMITS.emailLocalLength ||
      !EMAIL_LOCAL.test(local) ||
      local.startsWith(".") ||
      local.endsWith(".") ||
      local.includes("..") ||
      local.includes("=?") // MIME encoded-word lookalike: nothing legitimate needs it
    ) {
      return fail("email", "invalid");
    }
    const domain = asciiDomain(s.slice(at + 1));
    if (!domain) return fail("email", "invalid");
    const email = `${local.toLowerCase()}@${domain}`;
    if (email.length > LIMITS.emailLength) return fail("email", "invalid");
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
