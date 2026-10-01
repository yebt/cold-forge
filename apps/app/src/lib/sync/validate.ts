import {
  LIMITS,
  SYNC_PROTOCOL_VERSION,
  emptyChanges,
  normalizeEmail,
  parseSyncRequest,
  type SessionResponse,
  type SyncChanges,
  type SyncProfile,
} from "@cold-forge/sync";

/**
 * Validation of everything the server (or device storage) hands back. The record rules are the
 * shared ones from `@cold-forge/sync` (`parseSyncRequest`), applied in chunks so a server that
 * pages differently than the per-request limits still validates.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Upper bound on records accepted in one response / stored in history. */
export const MAX_RECORDS = 200_000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
/** Opaque cursor: printable ASCII, bounded. */
const CURSOR = /^[\x21-\x7e]{1,512}$/;
/** Bearer tokens must be header-safe (no CR/LF/space), bounded. */
const TOKEN = /^[A-Za-z0-9._~+/=-]{16,1024}$/;
const USER_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function isTimestamp(v: unknown): v is string {
  return typeof v === "string" && TIMESTAMP.test(v) && !Number.isNaN(Date.parse(v));
}

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Strictly validates a change set (unknown fields dropped). `now` bounds future timestamps. */
export function parseChanges(raw: unknown, now: number): Result<SyncChanges> {
  if (!isObj(raw)) return { ok: false, error: "changes: must be an object" };
  const arcs = raw.arcs ?? [];
  const habits = raw.habits ?? [];
  const checkIns = raw.checkIns ?? [];
  if (!Array.isArray(arcs) || !Array.isArray(habits) || !Array.isArray(checkIns)) {
    return { ok: false, error: "changes: lists must be arrays" };
  }
  if (arcs.length + habits.length + checkIns.length > MAX_RECORDS) return { ok: false, error: "changes: too many records" };
  const out: SyncChanges = emptyChanges();
  const check = (changes: Record<string, unknown>): Result<SyncChanges> => {
    const r = parseSyncRequest({ protocol: SYNC_PROTOCOL_VERSION, cursor: null, changes }, now);
    return r.ok ? { ok: true, value: r.value.changes } : r;
  };
  const steps: [unknown[], number, keyof Omit<SyncChanges, "profile">][] = [
    [arcs, LIMITS.maxArcsPerRequest, "arcs"],
    [habits, LIMITS.maxHabitsPerRequest, "habits"],
    [checkIns, LIMITS.maxCheckInsPerRequest, "checkIns"],
  ];
  for (const [list, size, key] of steps) {
    for (const chunk of chunks(list, size)) {
      const r = check({ arcs: [], habits: [], checkIns: [], profile: null, [key]: chunk });
      if (!r.ok) return r;
      (out[key] as unknown[]).push(...r.value[key]);
    }
  }
  const p = check({ arcs: [], habits: [], checkIns: [], profile: raw.profile ?? null });
  if (!p.ok) return p;
  out.profile = p.value.profile;
  return { ok: true, value: out };
}

export function parseProfile(raw: unknown, now: number): SyncProfile | null {
  const r = parseChanges({ profile: raw }, now);
  return r.ok ? r.value.profile : null;
}

export interface SyncPage {
  cursor: string;
  changes: SyncChanges;
  serverTime: string;
  hasMore: boolean;
}

export function parseSyncPage(raw: unknown, localNow = Date.now()): Result<SyncPage> {
  if (!isObj(raw)) return { ok: false, error: "body: must be an object" };
  if (raw.protocol !== SYNC_PROTOCOL_VERSION) return { ok: false, error: "protocol: unsupported" };
  if (typeof raw.cursor !== "string" || !CURSOR.test(raw.cursor)) return { ok: false, error: "cursor: invalid" };
  if (!isTimestamp(raw.serverTime)) return { ok: false, error: "serverTime: invalid" };
  if (raw.hasMore !== undefined && typeof raw.hasMore !== "boolean") return { ok: false, error: "hasMore: invalid" };
  // Records may be up to the server's clock (+ the shared skew allowance), even if ours is behind.
  const now = Math.max(localNow, Date.parse(raw.serverTime));
  const changes = parseChanges(raw.changes, now);
  if (!changes.ok) return changes;
  return {
    ok: true,
    value: { cursor: raw.cursor, changes: changes.value, serverTime: raw.serverTime, hasMore: raw.hasMore === true },
  };
}

export function isSafeToken(v: unknown): v is string {
  return typeof v === "string" && TOKEN.test(v);
}

export function parseSession(raw: unknown): Result<SessionResponse> {
  if (!isObj(raw) || !isObj(raw.user)) return { ok: false, error: "session: must be an object" };
  if (!isSafeToken(raw.token)) return { ok: false, error: "session.token: invalid" };
  if (typeof raw.expiresAt !== "string" || Number.isNaN(Date.parse(raw.expiresAt))) {
    return { ok: false, error: "session.expiresAt: invalid" };
  }
  if (typeof raw.user.id !== "string" || !USER_ID.test(raw.user.id)) return { ok: false, error: "session.user.id: invalid" };
  const email = normalizeEmail(raw.user.email);
  if (!email.ok) return { ok: false, error: "session.user.email: invalid" };
  return {
    ok: true,
    value: { token: raw.token, expiresAt: raw.expiresAt, user: { id: raw.user.id, email: email.value } },
  };
}
