import type { SyncChanges, SyncCheckIn } from "./types.ts";

interface Versioned {
  updatedAt: string;
}

/** Last-write-wins: does `incoming` replace `current`? Ties keep the current record (idempotent replays). */
export function incomingWins(current: Versioned | undefined, incoming: Versioned): boolean {
  return current === undefined || Date.parse(incoming.updatedAt) > Date.parse(current.updatedAt);
}

export const checkInKey = (c: Pick<SyncCheckIn, "habitId" | "date">) => `${c.habitId}|${c.date}`;

function mergeBy<T extends Versioned>(current: readonly T[], incoming: readonly T[], key: (r: T) => string): T[] {
  const map = new Map(current.map((r) => [key(r), r]));
  for (const r of incoming) {
    if (incomingWins(map.get(key(r)), r)) map.set(key(r), r);
  }
  return [...map.values()];
}

/** Merges two change sets record by record. Pure and commutative for distinct timestamps. */
export function mergeChanges(current: SyncChanges, incoming: SyncChanges): SyncChanges {
  return {
    arcs: mergeBy(current.arcs, incoming.arcs, (a) => a.id),
    habits: mergeBy(current.habits, incoming.habits, (h) => h.id),
    checkIns: mergeBy(current.checkIns, incoming.checkIns, checkInKey),
    profile:
      incoming.profile && incomingWins(current.profile ?? undefined, incoming.profile)
        ? incoming.profile
        : current.profile,
  };
}

export const emptyChanges = (): SyncChanges => ({ arcs: [], habits: [], checkIns: [], profile: null });
