import {
  SYNC_PROTOCOL_VERSION,
  canonicalTimestamp,
  emptyChanges,
  parseSyncRequest,
  type SyncArc,
  type SyncChanges,
  type SyncCheckIn,
  type SyncHabit,
  type SyncProfile,
  type ParseOptions,
} from "@cold-forge/sync";
import { repairEmoji, repairHabitName, repairText } from "../fields.ts";

/**
 * Last line of defence before a push: every outgoing record is checked with the API's own
 * validator, including the write-time bounds the Firestore rules enforce (`WRITE_BOUNDS`: check-in
 * dates within [now - 400 d, now + 2 d], arcs from 2024-01-01 and at most 366 days, timestamps
 * from 2024, createdAt <= updatedAt). A record that fails is repaired if possible (text, emoji,
 * timestamp format, createdAt after updatedAt); otherwise it is skipped and stays pending locally
 * (e.g. check-ins older than 400 days from an imported export: kept on the device, never pushed).
 * One bad record never blocks the batch.
 */
export interface Outgoing {
  changes: SyncChanges;
  repaired: number;
  skipped: number;
  /**
   * Check-ins of tombstoned habits: the rules refuse them for good (a check-in's habit must be
   * live), so the caller marks them as settled instead of retrying them forever.
   */
  obsolete: SyncCheckIn[];
}

export type RecordKind = "arcs" | "habits" | "checkIns" | "profile";
type Kind = RecordKind;

/**
 * The record as the shared validator returns it (canonical timestamps, unknown fields dropped), or
 * null. Write-time bounds are on by default; pass `{ bounds: false }` for records read back.
 */
export function checkRecord<T>(kind: RecordKind, record: T, now: number, opts: ParseOptions = {}): T | null {
  const changes: Record<string, unknown> = { arcs: [], habits: [], checkIns: [], profile: null };
  changes[kind] = kind === "profile" ? record : [record];
  const r = parseSyncRequest({ protocol: SYNC_PROTOCOL_VERSION, cursor: null, changes }, now, opts);
  if (!r.ok) return null;
  return (kind === "profile" ? r.value.changes.profile : (r.value.changes[kind] as unknown[])[0]) as T;
}

const ts = (v: string) => canonicalTimestamp(v) ?? v;
/**
 * createdAt can't be after updatedAt (device clock moved back between creating and editing).
 * Safe even though the rules keep createdAt immutable: a record the server already holds was
 * accepted with createdAt <= updatedAt, and any newer local edit only raises updatedAt.
 */
const created = (createdAt: string, updatedAt: string) => {
  const c = ts(createdAt);
  const u = ts(updatedAt);
  return c > u ? u : c;
};

function repairArc(a: SyncArc): SyncArc {
  return {
    ...a,
    why: repairText("why", a.why),
    createdAt: created(a.createdAt, a.updatedAt),
    updatedAt: ts(a.updatedAt),
    ...(a.deletedAt ? { deletedAt: ts(a.deletedAt) } : {}),
  };
}

function repairHabit(h: SyncHabit): SyncHabit {
  return {
    ...h,
    name: repairHabitName(h.name, !!h.templateId),
    emoji: repairEmoji(h.emoji),
    createdAt: created(h.createdAt, h.updatedAt),
    updatedAt: ts(h.updatedAt),
    ...(h.deletedAt ? { deletedAt: ts(h.deletedAt) } : {}),
  };
}

const repairCheckIn = (c: SyncCheckIn): SyncCheckIn => ({ ...c, updatedAt: ts(c.updatedAt) });
const repairProfile = (p: SyncProfile): SyncProfile => ({
  ...p,
  displayName: repairText("displayName", p.displayName),
  updatedAt: ts(p.updatedAt),
});

/**
 * Parents the backend already has or that are being sent. Backends that enforce references
 * (Firestore rules: a habit's arc and a check-in's habit must exist and not be tombstoned, the
 * profile's current arc must exist) would reject the whole atomic write for one orphan, so
 * children of unknown, tombstoned or held-back parents stay pending.
 */
export interface KnownParents {
  arcIds: ReadonlySet<string>;
  habitIds: ReadonlySet<string>;
  /** Tombstoned (deletedAt) arcs / habits among the known ones. */
  deadArcIds?: ReadonlySet<string>;
  deadHabitIds?: ReadonlySet<string>;
}

/** Known parents of a set of local records (all of them, not just the dirty ones). */
export function knownParents(all: SyncChanges): KnownParents {
  return {
    arcIds: new Set(all.arcs.map((a) => a.id)),
    habitIds: new Set(all.habits.map((h) => h.id)),
    deadArcIds: new Set(all.arcs.filter((a) => a.deletedAt).map((a) => a.id)),
    deadHabitIds: new Set(all.habits.filter((h) => h.deletedAt).map((h) => h.id)),
  };
}

export function prepareOutgoing(dirty: SyncChanges, now: number, known?: KnownParents): Outgoing {
  const out = emptyChanges();
  const obsolete: SyncCheckIn[] = [];
  let repaired = 0;
  let skipped = 0;
  const take = <T>(kind: Kind, record: T, repair: (r: T) => T): T | null => {
    const ok = checkRecord(kind, record, now);
    if (ok) return ok;
    const fixed = checkRecord(kind, repair(record), now);
    if (fixed) repaired++;
    else skipped++;
    return fixed;
  };
  const heldArcs = new Set<string>();
  const heldHabits = new Set<string>();
  for (const a of dirty.arcs) {
    const r = take("arcs", a, repairArc);
    if (r) out.arcs.push(r);
    else heldArcs.add(a.id);
  }
  for (const h of dirty.habits) {
    const deadArc = !h.deletedAt && known?.deadArcIds?.has(h.arcId);
    if (known && (!known.arcIds.has(h.arcId) || heldArcs.has(h.arcId) || deadArc)) {
      skipped++;
      heldHabits.add(h.id);
      continue;
    }
    const r = take("habits", h, repairHabit);
    if (r) out.habits.push(r);
    else heldHabits.add(h.id);
  }
  for (const c of dirty.checkIns) {
    if (known?.deadHabitIds?.has(c.habitId)) {
      obsolete.push(c);
      continue;
    }
    if (known && (!known.habitIds.has(c.habitId) || heldHabits.has(c.habitId))) {
      skipped++;
      continue;
    }
    const r = take("checkIns", c, repairCheckIn);
    if (r) out.checkIns.push(r);
  }
  if (dirty.profile) {
    const arcId = dirty.profile.currentArcId;
    // The rules need the current arc to exist after the write: hold the profile with its arc.
    if (arcId && known && (heldArcs.has(arcId) || !known.arcIds.has(arcId))) skipped++;
    else out.profile = take("profile", dirty.profile, repairProfile);
  }
  return { changes: out, repaired, skipped, obsolete };
}
