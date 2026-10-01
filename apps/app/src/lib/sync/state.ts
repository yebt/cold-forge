import { isId, type SyncProfile } from "@cold-forge/sync";
import { emptyHistory, type History } from "./mapping.ts";
import { isTimestamp, parseChanges, parseProfile } from "./validate.ts";

/** Sync bookkeeping, stored on the device next to (not inside) AppData. */
export interface SyncState {
  /** Account the cursor and acks belong to. A different account starts over. */
  userId: string | null;
  /** Opaque server cursor; `null` means "never synced with this account" (first sync). */
  cursor: string | null;
  /** Local clock at the last successful sync (display only). */
  lastSyncedAt: string | null;
  /**
   * Record key -> the `updatedAt` the server is known to hold. A local record is dirty when its
   * `updatedAt` differs, which stays correct whatever the device clock does.
   */
  acked: Map<string, string>;
  history: History;
  /** First sign-in found a different arc on the account: waiting for the user to pick one. */
  conflict: { serverArcId: string; serverProfile: SyncProfile } | null;
}

export const emptySyncState = (): SyncState => ({
  userId: null,
  cursor: null,
  lastSyncedAt: null,
  acked: new Map(),
  history: emptyHistory(),
  conflict: null,
});

/** Forget everything tied to an account, but keep the local history (it is the user's data). */
export function forgetAccount(state: SyncState): SyncState {
  return { ...emptySyncState(), history: state.history };
}

export const STATE_VERSION = 1;

export function serializeSyncState(state: SyncState): string {
  return JSON.stringify({
    v: STATE_VERSION,
    userId: state.userId,
    cursor: state.cursor,
    lastSyncedAt: state.lastSyncedAt,
    acked: [...state.acked],
    history: state.history,
    conflict: state.conflict,
  });
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ACK_KEY = /^(a:|h:|c:)?[0-9a-fA-F-]{32,36}(\|\d{4}-\d{2}-\d{2})?$|^p$/;
/** Stored records are ours; don't let a clock that moved backwards discard them. */
const NO_FUTURE_LIMIT = Number.MAX_SAFE_INTEGER / 2;

/** Parses stored sync state. Anything malformed falls back to a clean state (the server has the data). */
export function parseSyncState(text: string | null): SyncState {
  if (!text) return emptySyncState();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return emptySyncState();
  }
  if (!isObj(raw) || raw.v !== STATE_VERSION) return emptySyncState();
  const history = parseChanges(raw.history, NO_FUTURE_LIMIT);
  const acked = new Map<string, string>();
  if (Array.isArray(raw.acked)) {
    for (const pair of raw.acked) {
      if (Array.isArray(pair) && typeof pair[0] === "string" && ACK_KEY.test(pair[0]) && isTimestamp(pair[1])) {
        acked.set(pair[0], pair[1]);
      }
    }
  }
  let conflict: SyncState["conflict"] = null;
  if (isObj(raw.conflict) && isId(raw.conflict.serverArcId)) {
    const serverProfile = parseProfile(raw.conflict.serverProfile, NO_FUTURE_LIMIT);
    if (serverProfile) conflict = { serverArcId: raw.conflict.serverArcId, serverProfile };
  }
  const userId = typeof raw.userId === "string" && raw.userId.length <= 128 ? raw.userId : null;
  const cursor = typeof raw.cursor === "string" && raw.cursor.length <= 512 ? raw.cursor : null;
  return {
    userId,
    cursor: userId ? cursor : null,
    lastSyncedAt: isTimestamp(raw.lastSyncedAt) ? raw.lastSyncedAt : null,
    acked: userId ? acked : new Map(),
    history: history.ok
      ? { arcs: history.value.arcs, habits: history.value.habits, checkIns: history.value.checkIns }
      : emptyHistory(),
    conflict: userId ? conflict : null,
  };
}
