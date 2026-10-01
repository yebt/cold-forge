import type { SyncArc, SyncChanges } from "@cold-forge/sync";
import type { AppData } from "../model.ts";

export type FirstSyncDecision =
  /** Nothing to ask: the account is empty, or already on this device's arc. Merge and push. */
  | { kind: "push" }
  /** This device has no arc yet: use the account's. */
  | { kind: "adopt"; arcId: string }
  /** The account is forging a different arc than this device: ask which one to keep. */
  | { kind: "conflict"; serverArcId: string };

/** The account's current arc, if it names one that exists and isn't deleted. */
export function serverCurrentArc(server: SyncChanges): SyncArc | null {
  const id = server.profile?.currentArcId;
  if (!id) return null;
  return server.arcs.find((a) => a.id === id && !a.deletedAt) ?? null;
}

/** Decides what the first sync with an account does, from everything the server holds. */
export function decideFirstSync(local: AppData | null, server: SyncChanges): FirstSyncDecision {
  const remote = serverCurrentArc(server);
  if (!remote) return { kind: "push" };
  if (!local) return { kind: "adopt", arcId: remote.id };
  if (local.arc.id === remote.id) return { kind: "push" };
  return { kind: "conflict", serverArcId: remote.id };
}

export interface ArcSummary {
  kind: SyncArc["kind"];
  startDate: string;
  endDate: string;
  habits: number;
  checkIns: number;
}

/** What the conflict dialog shows for the account's arc. */
export function summarizeServerArc(history: Pick<SyncChanges, "arcs" | "habits" | "checkIns">, arcId: string): ArcSummary | null {
  const arc = history.arcs.find((a) => a.id === arcId);
  if (!arc) return null;
  const habitIds = new Set(history.habits.filter((h) => h.arcId === arcId && !h.deletedAt).map((h) => h.id));
  return {
    kind: arc.kind,
    startDate: arc.startDate,
    endDate: arc.endDate,
    habits: habitIds.size,
    checkIns: history.checkIns.filter((c) => c.done && habitIds.has(c.habitId)).length,
  };
}
