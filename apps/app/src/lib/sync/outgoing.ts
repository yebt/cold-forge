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
} from "@cold-forge/sync";
import { repairEmoji, repairHabitName, repairText } from "../fields.ts";

/**
 * Last line of defence before a push: every outgoing record is checked with the API's own
 * validator. A record that fails is repaired if possible (text, emoji, timestamp format);
 * otherwise it is skipped and stays pending locally. One bad record never blocks the batch.
 */
export interface Outgoing {
  changes: SyncChanges;
  repaired: number;
  skipped: number;
}

export type RecordKind = "arcs" | "habits" | "checkIns" | "profile";
type Kind = RecordKind;

/** The record as the shared validator returns it (canonical timestamps, unknown fields dropped), or null. */
export function checkRecord<T>(kind: RecordKind, record: T, now: number): T | null {
  const changes: Record<string, unknown> = { arcs: [], habits: [], checkIns: [], profile: null };
  changes[kind] = kind === "profile" ? record : [record];
  const r = parseSyncRequest({ protocol: SYNC_PROTOCOL_VERSION, cursor: null, changes }, now);
  if (!r.ok) return null;
  return (kind === "profile" ? r.value.changes.profile : (r.value.changes[kind] as unknown[])[0]) as T;
}

const ts = (v: string) => canonicalTimestamp(v) ?? v;

function repairArc(a: SyncArc): SyncArc {
  return {
    ...a,
    why: repairText("why", a.why),
    createdAt: ts(a.createdAt),
    updatedAt: ts(a.updatedAt),
    ...(a.deletedAt ? { deletedAt: ts(a.deletedAt) } : {}),
  };
}

function repairHabit(h: SyncHabit): SyncHabit {
  return {
    ...h,
    name: repairHabitName(h.name, !!h.templateId),
    emoji: repairEmoji(h.emoji),
    createdAt: ts(h.createdAt),
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
 * (Firestore rules: a habit's arc and a check-in's habit must exist) would reject the whole
 * atomic write for one orphan, so children of unknown or held-back parents stay pending.
 */
export interface KnownParents {
  arcIds: ReadonlySet<string>;
  habitIds: ReadonlySet<string>;
}

export function prepareOutgoing(dirty: SyncChanges, now: number, known?: KnownParents): Outgoing {
  const out = emptyChanges();
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
    if (known && (!known.arcIds.has(h.arcId) || heldArcs.has(h.arcId))) {
      skipped++;
      heldHabits.add(h.id);
      continue;
    }
    const r = take("habits", h, repairHabit);
    if (r) out.habits.push(r);
    else heldHabits.add(h.id);
  }
  for (const c of dirty.checkIns) {
    if (known && (!known.habitIds.has(c.habitId) || heldHabits.has(c.habitId))) {
      skipped++;
      continue;
    }
    const r = take("checkIns", c, repairCheckIn);
    if (r) out.checkIns.push(r);
  }
  if (dirty.profile) out.profile = take("profile", dirty.profile, repairProfile);
  return { changes: out, repaired, skipped };
}
