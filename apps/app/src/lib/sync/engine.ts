import type { ISODate } from "@cold-forge/core";
import { emptyChanges, mergeChanges, type SessionResponse, type SyncChanges } from "@cold-forge/sync";
import type { AppData } from "../model.ts";
import type { ApiClient, ApiError, ApiResult } from "./api.ts";
import { decideFirstSync, summarizeServerArc, type ArcSummary } from "./conflict.ts";
import { linkNeedsConfirmation, type PendingCodeRequest } from "./linkConfirm.ts";
import { collectDirty, isEmpty, markAcked, splitBatches } from "./dirty.ts";
import { prepareOutgoing } from "./outgoing.ts";
import { httpTransport, type SyncTransport } from "./transport.ts";
import { applyRemote, localRecords } from "./mapping.ts";
import { emptySyncState, forgetAccount, parseSyncState, serializeSyncState, type SyncState } from "./state.ts";
import { parseSession } from "./validate.ts";

export type SyncStatus =
  | "signedOut"
  | "idle"
  | "syncing"
  | "offline"
  | "error"
  | "rateLimited"
  /** The account is over its storage quota: automatic retries stop until the next manual sync. */
  | "quota"
  /** The server refused our data (400): sync is paused, no retry loop ("contact support"). */
  | "rejected"
  | "conflict";
export type SyncNotice = "signedIn" | "linkInvalid" | "linkFailed" | "sessionExpired" | "accountDeleted" | null;
export type SyncReason = "start" | "resume" | "online" | "signin" | "manual" | "local" | "retry";

export interface SyncSnapshot {
  /** Session and state have been read from storage. */
  loaded: boolean;
  account: { email: string } | null;
  status: SyncStatus;
  lastSyncedAt: string | null;
  conflict: { serverArcId: string; server: ArcSummary | null } | null;
  notice: SyncNotice;
  /** A sign-in link was verified but awaits the user's "yes, it's me" (login-CSRF guard). */
  pendingLink: { email: string } | null;
}

/** Persistence for the session token and sync bookkeeping (kept apart from AppData). */
export interface SyncStorage {
  loadSession(): Promise<string | null>;
  saveSession(value: string): Promise<void>;
  clearSession(): Promise<void>;
  loadState(): Promise<string | null>;
  saveState(value: string): Promise<void>;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface SyncEngineDeps {
  /** Account operations (sign-in links, logout, delete). */
  api: ApiClient;
  /** Record exchange. Defaults to the HTTP API's /v1/sync. */
  transport?: SyncTransport;
  storage: SyncStorage;
  /** The latest AppData (null while onboarding). */
  getData(): AppData | null;
  /** Persist + render data changed by a sync. Never called for unchanged data. */
  setData(data: AppData): void;
  today(): ISODate;
  now?: () => number;
  timers?: Timers;
  random?: () => number;
  debounceMs?: number;
}

export interface SyncEngine {
  init(): Promise<void>;
  dispose(): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): SyncSnapshot;
  readonly api: ApiClient;
  signIn(session: SessionResponse): Promise<void>;
  /**
   * Verifies the token from an emailed link. Unless this app just requested a code for the same
   * email, the session is held in memory only and `pendingLink` asks the user to confirm.
   */
  signInWithLinkToken(token: string): Promise<ApiResult<void>>;
  confirmLink(): Promise<void>;
  /** Discards the link's session and revokes it server-side. */
  cancelLink(): Promise<void>;
  /** Remember that the user asked for a code for `email` on this device (in memory only). */
  noteCodeRequested(email: string): void;
  signOut(): Promise<void>;
  deleteAccount(): Promise<ApiResult<void>>;
  requestSync(reason: SyncReason): Promise<void>;
  /** Call after every local edit: syncs ~3 s after the last one. */
  notifyLocalChange(): void;
  resolveConflict(choice: "device" | "account"): Promise<void>;
  /** "Reset arc" also erases the archived arcs on this device. */
  clearHistory(): Promise<void>;
  dismissNotice(): void;
  /** A sign-in link with a malformed token was opened. */
  reportInvalidLink(): void;
}

const MAX_PAGES = 500;
/** The API allows 20 sync calls/min; stay under it on our own instead of collecting 429s. */
const SYNC_BUDGET = { calls: 15, windowMs: 60_000 };
const RESUME_THROTTLE_MS = 15_000;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60_000;

type Outcome = { ok: true } | { ok: false; error: ApiError } | { ok: "stale" };

export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  const { api, storage } = deps;
  const transport = deps.transport ?? httpTransport(api);
  const now = deps.now ?? Date.now;
  const timers: Timers = deps.timers ?? {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const random = deps.random ?? Math.random;
  const debounceMs = deps.debounceMs ?? 3_000;

  let session: SessionResponse | null = null;
  let state: SyncState = emptySyncState();
  /** Bumped on every sign-in/out so a sync in flight never writes into the next account's state. */
  let generation = 0;
  let running: Promise<void> | null = null;
  let rerun: SyncReason | null = null;
  let retryTimer: unknown = null;
  let debounceTimer: unknown = null;
  let failures = 0;
  let blockedUntil = 0;
  let lastSuccessAt = 0;
  /** Cursor resets in a row; a server that keeps rejecting cursors must not loop us forever. */
  let cursorResets = 0;
  /** Times of recent /v1/sync calls (client-side rate budget). */
  let syncCalls: number[] = [];
  let disposed = false;
  let pendingRequest: PendingCodeRequest | null = null;
  /** Verified via a link, not yet confirmed: never persisted, never used for sync. */
  let unconfirmed: SessionResponse | null = null;
  const listeners = new Set<() => void>();

  let snapshot: SyncSnapshot = {
    loaded: false,
    account: null,
    status: "signedOut",
    lastSyncedAt: null,
    conflict: null,
    notice: null,
    pendingLink: null,
  };

  function emit(patch: Partial<SyncSnapshot>) {
    snapshot = { ...snapshot, ...patch };
    for (const l of listeners) l();
  }

  function conflictView(): SyncSnapshot["conflict"] {
    if (!state.conflict) return null;
    return { serverArcId: state.conflict.serverArcId, server: summarizeServerArc(state.history, state.conflict.serverArcId) };
  }

  function baseSnapshot(): Partial<SyncSnapshot> {
    return {
      account: session ? { email: session.user.email } : null,
      lastSyncedAt: state.lastSyncedAt,
      conflict: conflictView(),
      ...(session ? {} : { status: "signedOut" as const }),
      ...(session && state.conflict ? { status: "conflict" as const } : {}),
    };
  }

  const persistState = () => storage.saveState(serializeSyncState(state)).catch(() => undefined);
  const nowISO = () => new Date(now()).toISOString();

  function clearTimer(which: "retry" | "debounce") {
    if (which === "retry" && retryTimer !== null) {
      timers.clear(retryTimer);
      retryTimer = null;
    }
    if (which === "debounce" && debounceTimer !== null) {
      timers.clear(debounceTimer);
      debounceTimer = null;
    }
  }

  function scheduleRetry(ms: number) {
    clearTimer("retry");
    if (disposed) return;
    retryTimer = timers.set(() => {
      retryTimer = null;
      void requestSync("retry");
    }, ms);
  }

  async function dropSession(notice: SyncNotice) {
    generation++;
    session = null;
    state = forgetAccount(state);
    failures = 0;
    blockedUntil = 0;
    clearTimer("retry");
    clearTimer("debounce");
    await Promise.all([storage.clearSession().catch(() => undefined), persistState()]);
    emit({ ...baseSnapshot(), status: "signedOut", notice });
  }

  // ---- Applying server changes ----

  function apply(
    changes: SyncChanges,
    opts: { forceCurrentArcId?: string; incomingProfileWins?: boolean; keepEmpty?: boolean } = {},
  ) {
    const r = applyRemote(deps.getData(), state.history, changes, { today: deps.today(), now: nowISO(), ...opts });
    state.history = r.history;
    markAcked(state.acked, changes);
    if (r.changed && r.data) deps.setData(r.data);
  }

  /** Local changes that can be sent: validated/repaired; invalid ones stay pending (never block the batch). */
  function pushable(warn = false): SyncChanges {
    const dirty = collectDirty(localRecords(deps.getData(), state.history), state.acked);
    if (isEmpty(dirty)) return dirty;
    const out = prepareOutgoing(dirty, now());
    if (warn && (out.skipped > 0 || out.repaired > 0)) {
      // Counts only: never record contents (they are personal data).
      console.warn(`[sync] outgoing records: ${out.repaired} repaired, ${out.skipped} held back as invalid`);
    }
    return out.changes;
  }

  async function budgetedSync(token: string, req: { cursor: string | null; changes: SyncChanges }) {
    const t = now();
    syncCalls = syncCalls.filter((c) => t - c < SYNC_BUDGET.windowMs);
    if (syncCalls.length >= SYNC_BUDGET.calls) {
      const wait = syncCalls[0]! + SYNC_BUDGET.windowMs - t;
      return { ok: false as const, error: { kind: "rate_limited" as const, retryAfterMs: Math.max(1_000, wait) } };
    }
    syncCalls.push(t);
    return transport.exchange(token, req);
  }

  // ---- One sync run ----

  /** Push local changes in batches and pull everything after the cursor (following `hasMore`). */
  async function exchange(token: string, gen: number): Promise<Outcome> {
    const batches = splitBatches(pushable(true));
    let i = 0;
    let pages = 0;
    let more = false;
    do {
      const batch = batches[i++] ?? emptyChanges();
      const res = await budgetedSync(token, { cursor: state.cursor, changes: batch });
      if (gen !== generation) return { ok: "stale" };
      if (!res.ok) return res;
      markAcked(state.acked, batch);
      // Only a first sync brings the account's arc onto an empty device (see firstSync).
      apply(res.value.changes, { keepEmpty: true });
      state.cursor = res.value.cursor;
      more = res.value.hasMore;
      await persistState();
    } while ((more || i < batches.length) && ++pages < MAX_PAGES);
    return { ok: true };
  }

  /** First sync with an account: pull everything, then decide whether to ask the user. */
  async function firstSync(token: string, gen: number): Promise<Outcome> {
    let cursor: string | null = null;
    let staged = emptyChanges();
    let pages = 0;
    let more = true;
    while (more && pages++ < MAX_PAGES) {
      const res = await budgetedSync(token, { cursor, changes: emptyChanges() });
      if (gen !== generation) return { ok: "stale" };
      if (!res.ok) return res;
      staged = mergeChanges(staged, res.value.changes);
      cursor = res.value.cursor;
      more = res.value.hasMore;
    }
    const data = deps.getData();
    const decision = decideFirstSync(data, staged);
    if (decision.kind === "conflict" && data && staged.profile) {
      // Keep showing this device's arc; the account's records wait in history until the user picks.
      apply({ ...staged, profile: null }, { forceCurrentArcId: data.arc.id });
      state.conflict = { serverArcId: decision.serverArcId, serverProfile: staged.profile };
      state.cursor = cursor;
      await persistState();
      return { ok: true };
    }
    apply(staged);
    state.cursor = cursor;
    await persistState();
    return exchange(token, gen);
  }

  async function runOnce(reason: SyncReason): Promise<void> {
    if (!session) return;
    const token = session.token;
    const gen = generation;

    if (state.conflict) {
      if (deps.getData()) {
        emit({ ...baseSnapshot(), status: "conflict" });
        return;
      }
      // This device's arc is gone (reset): nothing to choose. The account's arc stays in history
      // and whatever arc the user forges next becomes current.
      state.conflict = null;
      await persistState();
    }
    if (reason === "local" && state.cursor !== null && isEmpty(pushable())) return;

    emit({ ...baseSnapshot(), status: "syncing" });
    const outcome = state.cursor === null ? await firstSync(token, gen) : await exchange(token, gen);
    if (outcome.ok === "stale" || gen !== generation) return;

    if (outcome.ok) {
      failures = 0;
      cursorResets = 0;
      lastSuccessAt = now();
      state.lastSyncedAt = nowISO();
      await persistState();
      emit({ ...baseSnapshot(), status: state.conflict ? "conflict" : "idle" });
      // Applying the server's data can itself produce something to push (e.g. a profile fix-up).
      if (!state.conflict && !isEmpty(pushable())) {
        notifyLocalChange();
      }
      return;
    }

    const { error } = outcome;
    switch (error.kind) {
      case "unauthorized":
        await dropSession("sessionExpired");
        return;
      case "invalid_cursor":
        // The server forgot our cursor (e.g. restored backup): start over. Clearing the acks
        // re-sends everything; the server's merge is idempotent.
        if (cursorResets++ < 2) {
          state.cursor = null;
          state.acked.clear();
          await persistState();
          rerun = "retry";
          return;
        }
        break;
      case "quota_exceeded":
        emit({ ...baseSnapshot(), status: "quota" });
        return;
      case "invalid_request":
      case "bad_request":
        // Same data, same answer: don't loop. A manual "Sync now" (or the next edit) tries again.
        emit({ ...baseSnapshot(), status: "rejected" });
        return;
      case "rate_limited":
        blockedUntil = now() + error.retryAfterMs;
        scheduleRetry(error.retryAfterMs);
        emit({ ...baseSnapshot(), status: "rateLimited" });
        return;
      case "insecure":
        emit({ ...baseSnapshot(), status: "error" });
        return;
    }
    // Network trouble or a server error: exponential backoff with jitter.
    failures++;
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1)) * (0.75 + random() * 0.5);
    scheduleRetry(delay);
    emit({ ...baseSnapshot(), status: error.kind === "network" ? "offline" : "error" });
  }

  async function requestSync(reason: SyncReason): Promise<void> {
    if (disposed || !session) return;
    if (now() < blockedUntil) return; // 429: even a manual sync waits for Retry-After.
    if (reason === "resume" && now() - lastSuccessAt < RESUME_THROTTLE_MS) return;
    if (running) {
      // Single flight: remember to go again once the current run ends.
      if (rerun === null || reason !== "local") rerun = reason;
      return running;
    }
    if (reason !== "retry") clearTimer("retry");
    running = (async () => {
      try {
        let next: SyncReason | null = reason;
        while (next && !disposed) {
          rerun = null;
          await runOnce(next);
          next = rerun;
        }
      } catch (e) {
        console.warn("[sync] unexpected error", e instanceof Error ? e.message : "");
        emit({ ...baseSnapshot(), status: session ? "error" : "signedOut" });
      } finally {
        running = null;
      }
    })();
    return running;
  }

  function notifyLocalChange() {
    if (disposed || !session || state.conflict) return;
    clearTimer("debounce");
    debounceTimer = timers.set(() => {
      debounceTimer = null;
      void requestSync("local");
    }, debounceMs);
  }

  async function signIn(s: SessionResponse) {
    generation++;
    pendingRequest = null;
    session = s;
    if (state.userId !== s.user.id) state = { ...forgetAccount(state), userId: s.user.id };
    failures = 0;
    blockedUntil = 0;
    await Promise.all([storage.saveSession(JSON.stringify(s)).catch(() => undefined), persistState()]);
    emit({ ...baseSnapshot(), status: "idle", notice: null });
    void requestSync("signin");
  }

  async function resolveConflict(choice: "device" | "account") {
    if (!state.conflict) return;
    const { serverArcId, serverProfile } = state.conflict;
    const data = deps.getData();
    if (choice === "device" && data) {
      // This device's arc becomes the account's current arc; the account's arc stays as history.
      deps.setData({ ...data, settings: { ...data.settings, profileUpdatedAt: nowISO() } });
    } else {
      // Switch to the account's arc; this device's arc moves to history (and gets uploaded).
      apply(
        { arcs: [], habits: [], checkIns: [], profile: serverProfile },
        { forceCurrentArcId: serverArcId, incomingProfileWins: true },
      );
    }
    state.conflict = null;
    await persistState();
    emit({ ...baseSnapshot(), status: "idle" });
    void requestSync("manual");
  }

  return {
    api,

    async init() {
      const [rawSession, rawState] = await Promise.all([
        storage.loadSession().catch(() => null),
        storage.loadState().catch(() => null),
      ]);
      state = parseSyncState(rawState);
      let parsed: SessionResponse | null = null;
      if (rawSession) {
        try {
          const r = parseSession(JSON.parse(rawSession));
          if (r.ok && Date.parse(r.value.expiresAt) > now()) parsed = r.value;
        } catch {
          parsed = null;
        }
        if (!parsed) await storage.clearSession().catch(() => undefined);
      }
      session = parsed;
      if (session && state.userId !== session.user.id) state = { ...forgetAccount(state), userId: session.user.id };
      emit({ ...baseSnapshot(), loaded: true, status: session ? (state.conflict ? "conflict" : "idle") : "signedOut" });
      if (session) void requestSync("start");
    },

    dispose() {
      disposed = true;
      clearTimer("retry");
      clearTimer("debounce");
      listeners.clear();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot: () => snapshot,

    signIn,

    async signInWithLinkToken(token) {
      const r = await api.verify({ token });
      if (!r.ok) {
        emit({ notice: r.error.kind === "network" || r.error.kind === "rate_limited" ? "linkFailed" : "linkInvalid" });
        return r;
      }
      if (linkNeedsConfirmation(r.value.user.email, pendingRequest, now())) {
        // Replace (and revoke) any earlier unconfirmed link.
        const previous = unconfirmed;
        unconfirmed = r.value;
        if (previous) void api.logout(previous.token).catch(() => undefined);
        emit({ pendingLink: { email: r.value.user.email } });
        return { ok: true, value: undefined };
      }
      pendingRequest = null;
      await signIn(r.value);
      emit({ notice: "signedIn" });
      return { ok: true, value: undefined };
    },

    async confirmLink() {
      const s = unconfirmed;
      unconfirmed = null;
      emit({ pendingLink: null });
      if (!s) return;
      await signIn(s);
      emit({ notice: "signedIn" });
    },

    async cancelLink() {
      const s = unconfirmed;
      unconfirmed = null;
      emit({ pendingLink: null });
      if (s) void api.logout(s.token).catch(() => undefined);
    },

    noteCodeRequested(email) {
      pendingRequest = { email, at: now() };
    },

    async signOut() {
      const token = session?.token;
      await dropSession(null);
      // Best effort: revoke the token server-side. Local data is kept either way.
      if (token) void api.logout(token).catch(() => undefined);
    },

    async deleteAccount() {
      if (!session) return { ok: false, error: { kind: "unauthorized" } };
      const r = await api.deleteAccount(session.token);
      if (!r.ok && r.error.kind !== "unauthorized") return r;
      await dropSession("accountDeleted");
      return { ok: true, value: undefined };
    },

    requestSync,
    notifyLocalChange,
    resolveConflict,

    async clearHistory() {
      state.history = { arcs: [], habits: [], checkIns: [] };
      await persistState();
      emit(baseSnapshot());
    },

    dismissNotice() {
      emit({ notice: null });
    },

    reportInvalidLink() {
      emit({ notice: "linkInvalid" });
    },
  };
}
