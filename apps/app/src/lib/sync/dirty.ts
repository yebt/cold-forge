import { checkInKey, emptyChanges, type SyncChanges } from "@cold-forge/sync";

/** Stable key of a record across kinds (arc ids and habit ids live in different namespaces). */
export const keyOf = {
  arc: (a: { id: string }) => `a:${a.id}`,
  habit: (h: { id: string }) => `h:${h.id}`,
  checkIn: (c: { habitId: string; date: string }) => `c:${checkInKey(c)}`,
  profile: () => "p",
};

/**
 * Same instant? Compared by value, not by string: the server echoes timestamps with exactly
 * three fractional digits, so `…:00Z` and `…:00.000Z` must count as equal.
 */
export function sameInstant(a: string | undefined, b: string): boolean {
  return a !== undefined && (a === b || Date.parse(a) === Date.parse(b));
}

/** Records whose `updatedAt` differs from what the server is known to hold. */
export function collectDirty(all: SyncChanges, acked: ReadonlyMap<string, string>): SyncChanges {
  return {
    arcs: all.arcs.filter((a) => !sameInstant(acked.get(keyOf.arc(a)), a.updatedAt)),
    habits: all.habits.filter((h) => !sameInstant(acked.get(keyOf.habit(h)), h.updatedAt)),
    checkIns: all.checkIns.filter((c) => !sameInstant(acked.get(keyOf.checkIn(c)), c.updatedAt)),
    profile: all.profile && !sameInstant(acked.get(keyOf.profile()), all.profile.updatedAt) ? all.profile : null,
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
 * Splits a push into atomic writes of at most `maxRecords` records. Arcs go first, then habits,
 * then check-ins, so parents reach the backend before (or with) their children; the profile
 * rides in the first write.
 *
 * `maxParents` caps the distinct parents referenced in one write (a habit's arc, a check-in's
 * habit): Firestore rules verify each with `existsAfter()`, and a batched write may make at most
 * 20 such lookups (repeats of the same document count once).
 */
export function splitBatches(changes: SyncChanges, maxRecords: number, maxParents = Infinity): SyncChanges[] {
  const batches: SyncChanges[] = [];
  let cur = emptyChanges();
  cur.profile = changes.profile;
  let size = cur.profile ? 1 : 0;
  let parents = new Set<string>();
  const add = (parent: string | null, push: () => void) => {
    const newParent = parent !== null && !parents.has(parent);
    if (size >= maxRecords || (newParent && parents.size >= maxParents)) {
      batches.push(cur);
      cur = emptyChanges();
      size = 0;
      parents = new Set();
    }
    if (parent !== null) parents.add(parent);
    push();
    size++;
  };
  for (const a of changes.arcs) add(null, () => cur.arcs.push(a));
  for (const h of changes.habits) add(`a:${h.arcId}`, () => cur.habits.push(h));
  for (const c of changes.checkIns) add(`h:${c.habitId}`, () => cur.checkIns.push(c));
  if (!isEmpty(cur)) batches.push(cur);
  return batches;
}
