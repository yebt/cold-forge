import { LIMITS, checkInKey, emptyChanges, type SyncChanges } from "@cold-forge/sync";

/** Stable key of a record across kinds (arc ids and habit ids live in different namespaces). */
export const keyOf = {
  arc: (a: { id: string }) => `a:${a.id}`,
  habit: (h: { id: string }) => `h:${h.id}`,
  checkIn: (c: { habitId: string; date: string }) => `c:${checkInKey(c)}`,
  profile: () => "p",
};

/** Records whose `updatedAt` differs from what the server is known to hold. */
export function collectDirty(all: SyncChanges, acked: ReadonlyMap<string, string>): SyncChanges {
  return {
    arcs: all.arcs.filter((a) => acked.get(keyOf.arc(a)) !== a.updatedAt),
    habits: all.habits.filter((h) => acked.get(keyOf.habit(h)) !== h.updatedAt),
    checkIns: all.checkIns.filter((c) => acked.get(keyOf.checkIn(c)) !== c.updatedAt),
    profile: all.profile && acked.get(keyOf.profile()) !== all.profile.updatedAt ? all.profile : null,
  };
}

export function isEmpty(c: SyncChanges): boolean {
  return c.arcs.length === 0 && c.habits.length === 0 && c.checkIns.length === 0 && c.profile === null;
}

export function countRecords(c: SyncChanges): number {
  return c.arcs.length + c.habits.length + c.checkIns.length + (c.profile ? 1 : 0);
}

/** Records the server now holds (just pushed, or received from it). */
export function markAcked(acked: Map<string, string>, changes: SyncChanges): void {
  for (const a of changes.arcs) acked.set(keyOf.arc(a), a.updatedAt);
  for (const h of changes.habits) acked.set(keyOf.habit(h), h.updatedAt);
  for (const c of changes.checkIns) acked.set(keyOf.checkIn(c), c.updatedAt);
  if (changes.profile) acked.set(keyOf.profile(), changes.profile.updatedAt);
}

/**
 * Splits a push into requests within the API's per-request limits. Arcs go first, then habits,
 * then check-ins, so parents reach the server before their children.
 */
export function splitBatches(changes: SyncChanges): SyncChanges[] {
  const batches: SyncChanges[] = [];
  let cur = emptyChanges();
  cur.profile = changes.profile;
  const flushIfFull = (full: boolean) => {
    if (full) {
      batches.push(cur);
      cur = emptyChanges();
    }
  };
  for (const a of changes.arcs) {
    flushIfFull(cur.arcs.length >= LIMITS.maxArcsPerRequest);
    cur.arcs.push(a);
  }
  for (const h of changes.habits) {
    flushIfFull(cur.habits.length >= LIMITS.maxHabitsPerRequest);
    cur.habits.push(h);
  }
  for (const c of changes.checkIns) {
    flushIfFull(cur.checkIns.length >= LIMITS.maxCheckInsPerRequest);
    cur.checkIns.push(c);
  }
  if (!isEmpty(cur)) batches.push(cur);
  return batches;
}
