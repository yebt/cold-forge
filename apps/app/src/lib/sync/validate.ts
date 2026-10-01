import {
  LIMITS,
  canonicalTimestamp,
  SYNC_PROTOCOL_VERSION,
  emptyChanges,
  parseSyncRequest,
  type SyncChanges,
  type SyncProfile,
} from "@cold-forge/sync";

/**
 * Validation of everything the backend (or device storage) hands back. The record rules are the
 * shared ones from `@cold-forge/sync` (`parseSyncRequest`), applied in chunks so a server that
 * pages differently than the per-request limits still validates.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Upper bound on records accepted in one response / stored in history. */
export const MAX_RECORDS = 200_000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);


/** A real ISO UTC timestamp (0–3 fractional digits, round-trips). */
export function isTimestamp(v: unknown): v is string {
  return canonicalTimestamp(v) !== null;
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
