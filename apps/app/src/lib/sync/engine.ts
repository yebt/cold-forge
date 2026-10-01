import type { ISODate } from "@cold-forge/core";
import { emptyChanges, mergeChanges, type SyncChanges } from "@cold-forge/sync";
import type { AppData } from "../model.ts";
import type { AccountInfo, SyncBackend } from "./backend.ts";
import { decideFirstSync, summarizeServerArc, type ArcSummary } from "./conflict.ts";
import { collectDirty, isEmpty, markAcked, splitBatches } from "./dirty.ts";
import { err, type SyncError, type SyncResult } from "./errors.ts";
import { applyRemote, localRecords } from "./mapping.ts";
import { knownParents, prepareOutgoing } from "./outgoing.ts";
import { emptySyncState, forgetAccount, parseSyncState, serializeSyncState, type SyncState } from "./state.ts";
import type { SyncPage, SyncTransport } from "./transport.ts";

export type SyncStatus =
  | "signedOut"
  | "idle"
  | "syncing"
  | "offline"
  | "error"
  | "rateLimited"
  /** The backend refused our data even after a re-pull: paused, no retry loop ("contact support"). */
  | "rejected"
  /** The account is blocked server-side (disabled/deleted/over quota): stopped, no retries. */
  | "blocked"
  | "conflict";
export type SyncNotice = "signedIn" | "sessionExpired" | "accountDeleted" | null;
export type SyncReason = "start" | "resume" | "online" | "signin" | "manual" | "local" | "retry" | "remote";

export interface SyncSnapshot {
  /** Session flag and state have been read from storage. */
  loaded: boolean;
  account: { email: string } | null;
  status: SyncStatus;
  lastSyncedAt: string | null;
  conflict: { serverArcId: string; server: ArcSummary | null } | null;
  notice: SyncNotice;
  /** Realtime listeners are attached ("autosync"). */
  live: boolean;
}

/** Persistence for the signed-in flag and sync bookkeeping (kept apart from AppData). */
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
  /** Loads the backend on demand (dynamic import): guest mode never calls it. */
  loadBackend(): Promise<SyncBackend>;
  storage: SyncStorage;
  /** The latest AppData (null while onboarding). */
  getData(): AppData | null;
  /** Persist + render data changed by a sync. Never called for unchanged data. */
  setData(data: AppData): void;
  today(): ISODate;
  /** A redirect sign-in may be finishing: load the backend at start even without the flag. */
  redirectPending?: () => boolean;
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
  /** User tapped "Sign in with Google". */
  signIn(): Promise<SyncResult<void>>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<SyncResult<void>>;
  requestSync(reason: SyncReason): Promise<void>;
  /** Call after every local edit: syncs ~3 s after the last one. */
  notifyLocalChange(): void;
  /** App in the foreground: realtime listeners on; background: off. */
  setForeground(active: boolean): void;
  resolveConflict(choice: "device" | "account"): Promise<void>;
  /** "Reset arc" also erases the archived arcs on this device. */
  clearHistory(): Promise<void>;
  dismissNotice(): void;
}

const MAX_PAGES = 500;
const RESUME_THROTTLE_MS = 15_000;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60_000;

type Outcome = { ok: true } | { ok: false; error: SyncError } | { ok: "stale" };

/** The signed-in flag: who, never a credential (the SDK keeps those). */
function parseFlag(raw: string | null): AccountInfo | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<AccountInfo>;
    return typeof v.uid === "string" && v.uid.length <= 128 && typeof v.email === "string" && v.email.length <= 320
      ? { uid: v.uid, email: v.email }
      : null;
  } catch {
    return null;
  }
}

export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  const { storage } = deps;
  const now = deps.now ?? Date.now;
  const timers: Timers = deps.timers ?? {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const random = deps.random ?? Math.random;
  const debounceMs = deps.debounceMs ?? 3_000;

  let account: AccountInfo | null = null;
  let backend: SyncBackend | null = null;
  let transport: SyncTransport | null = null;
  let unwatchAuth: (() => void) | null = null;
  let state: SyncState = emptySyncState();
  /** Bumped on every sign-in/out so work in flight never writes into the next account's state. */
  let generation = 0;
  let running: Promise<void> | null = null;
  let rerun: SyncReason | null = null;
  let retryTimer: unknown = null;
  let debounceTimer: unknown = null;
  let failures = 0;
  let blockedUntil = 0;
  /** The server refuses this account (blocked/{uid}): only a user action tries again. */
  let accountBlocked = false;
  let lastSuccessAt = 0;
  let foreground = true;
  let unsubscribeLive: (() => void) | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();

  let snapshot: SyncSnapshot = {
    loaded: false,
    account: null,
    status: "signedOut",
    lastSyncedAt: null,
    conflict: null,
    notice: null,
    live: false,
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
      account: account ? { email: account.email } : null,
      lastSyncedAt: state.lastSyncedAt,
      conflict: conflictView(),
      live: unsubscribeLive !== null,
      ...(account ? {} : { status: "signedOut" as const }),
      ...(account && state.conflict ? { status: "conflict" as const } : {}),
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

  // ---- Backend ----

  /** Loads the backend (first call does the dynamic import) and watches for lost sessions. */
  async function ensureBackend(): Promise<SyncBackend> {
    if (backend) return backend;
    const b = await deps.loadBackend();
    if (backend) return backend;
    backend = b;
    unwatchAuth = b.onSignedOut(() => {
      if (account) void dropSession("sessionExpired");
    });
    return b;
  }

  function useAccount(a: AccountInfo) {
    generation++;
    account = a;
    transport = backend ? backend.transport(a.uid) : null;
    if (state.userId !== a.uid) state = { ...forgetAccount(state), userId: a.uid };
    failures = 0;
    blockedUntil = 0;
    accountBlocked = false;
  }

  async function dropSession(notice: SyncNotice) {
    generation++;
    stopLive();
    account = null;
    transport = null;
    state = forgetAccount(state);
    failures = 0;
    blockedUntil = 0;
    accountBlocked = false;
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

  /** Local changes that can be sent: validated/repaired, parents known; the rest stays pending. */
  function pushable(warn = false): SyncChanges {
    const all = localRecords(deps.getData(), state.history);
    const dirty = collectDirty(all, state.acked);
    if (isEmpty(dirty)) return dirty;
    const out = prepareOutgoing(dirty, now(), knownParents(all));
    // Check-ins of deleted habits can never be written (the rules refuse them): settle them.
    if (out.obsolete.length) markAcked(state.acked, { ...emptyChanges(), checkIns: out.obsolete });
    if (warn && (out.skipped > 0 || out.repaired > 0)) {
      // Counts only: never record contents (they are personal data).
      console.warn(`[sync] outgoing records: ${out.repaired} repaired, ${out.skipped} held back`);
    }
    return out.changes;
  }

  // ---- Realtime ("autosync") ----

  function stopLive() {
    if (!unsubscribeLive) return;
    unsubscribeLive();
    unsubscribeLive = null;
    emit({ live: false });
  }

  function startLive() {
    if (accountBlocked || unsubscribeLive || !foreground || !account || !transport?.subscribe || state.cursor === null || state.conflict) return;
    const t = transport;
    const gen = generation;
    unsubscribeLive = t.subscribe!(
      state.cursor,
      (page) => {
        if (gen !== generation) return;
        // Other devices' changes go through the same merge as a pull.
        apply(page.changes, { keepEmpty: true });
        state.cursor = t.maxCursor(state.cursor, page.cursor);
        state.lastSyncedAt = nowISO();
        void persistState();
        emit({ ...baseSnapshot(), status: "idle" });
        if (!isEmpty(pushable())) notifyLocalChange();
      },
      (e) => {
        if (gen !== generation) return;
        stopLive();
        if (!e.ok && e.error.kind === "unauthorized") void dropSession("sessionExpired");
        else if (!e.ok && e.error.kind === "blocked") markBlocked();
        else scheduleRetry(BACKOFF_BASE_MS); // re-attaches after the next successful sync
      },
    );
    emit({ live: true });
  }

  function markBlocked() {
    accountBlocked = true;
    stopLive();
    clearTimer("retry");
    clearTimer("debounce");
    emit({ ...baseSnapshot(), status: "blocked" });
  }

  // ---- One sync run ----

  /** Pull every page after the cursor and merge it. */
  async function pullAll(t: SyncTransport, gen: number, opts: { keepEmpty?: boolean } = { keepEmpty: true }): Promise<Outcome> {
    let more = true;
    let pages = 0;
    while (more && pages++ < MAX_PAGES) {
      const res = await t.pull(state.cursor);
      if (gen !== generation) return { ok: "stale" };
      if (!res.ok) return res;
      apply(res.value.changes, opts);
      state.cursor = t.maxCursor(state.cursor, res.value.cursor);
      more = res.value.hasMore;
      await persistState();
    }
    return { ok: true };
  }

  /** Push local changes in atomic batches. */
  async function pushAll(t: SyncTransport, gen: number): Promise<Outcome> {
    for (const batch of splitBatches(pushable(true), t.maxPushRecords, t.maxPushParents)) {
      const res = await t.push(batch);
      if (gen !== generation) return { ok: "stale" };
      if (!res.ok) return res;
      markAcked(state.acked, batch);
      await persistState();
    }
    return { ok: true };
  }

  /**
   * Pull first (so last-write-wins is resolved before writing), then push. A rejected batch
   * usually means another device won in between: pull, re-merge, retry once.
   */
  async function exchange(t: SyncTransport, gen: number): Promise<Outcome> {
    const pulled = await pullAll(t, gen);
    if (pulled.ok !== true) return pulled;
    const pushed = await pushAll(t, gen);
    if (pushed.ok === false && pushed.error.kind === "rejected") {
      const again = await pullAll(t, gen);
      if (again.ok !== true) return again;
      return pushAll(t, gen);
    }
    return pushed;
  }

  /** First sync with an account: pull everything, then decide whether to ask the user. */
  async function firstSync(t: SyncTransport, gen: number): Promise<Outcome> {
    let cursor: string | null = null;
    let staged = emptyChanges();
    let pages = 0;
    let more = true;
    while (more && pages++ < MAX_PAGES) {
      const res: SyncResult<SyncPage> = await t.pull(cursor);
      if (gen !== generation) return { ok: "stale" };
      if (!res.ok) return res;
      staged = mergeChanges(staged, res.value.changes);
      cursor = t.maxCursor(cursor, res.value.cursor);
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
    return pushAll(t, gen);
  }

  async function runOnce(reason: SyncReason): Promise<void> {
    if (!account) return;
    const gen = generation;

    if (!transport) {
      try {
        await ensureBackend();
      } catch {
        // The Firebase chunk couldn't load (offline, not cached yet): try again later.
        failures++;
        scheduleRetry(Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1)));
        emit({ ...baseSnapshot(), status: "offline" });
        return;
      }
      if (gen !== generation || !account) return;
      transport = backend!.transport(account.uid);
    }
    const t = transport;

    if (state.conflict) {
      if (deps.getData()) {
        emit({ ...baseSnapshot(), status: "conflict" });
        return;
      }
      // This device's arc is gone (reset): nothing to choose.
      state.conflict = null;
      await persistState();
    }
    if (reason === "local" && state.cursor !== null && isEmpty(pushable())) return;

    emit({ ...baseSnapshot(), status: "syncing" });
    const outcome = state.cursor === null ? await firstSync(t, gen) : await exchange(t, gen);
    if (outcome.ok === "stale" || gen !== generation) return;

    if (outcome.ok) {
      failures = 0;
      accountBlocked = false;
      lastSuccessAt = now();
      state.lastSyncedAt = nowISO();
      await persistState();
      emit({ ...baseSnapshot(), status: state.conflict ? "conflict" : "idle" });
      startLive();
      // Applying the server's data can itself produce something to push (e.g. a profile fix-up).
      if (!state.conflict && !isEmpty(pushable())) notifyLocalChange();
      return;
    }

    const { error } = outcome;
    switch (error.kind) {
      case "unauthorized":
        await dropSession("sessionExpired");
        return;
      case "blocked":
        markBlocked();
        return;
      case "rejected":
        // Still refused after a re-pull and one retry: don't loop. "Sync now" or the next edit retries.
        emit({ ...baseSnapshot(), status: "rejected" });
        return;
      case "rate_limited":
        blockedUntil = now() + error.retryAfterMs;
        scheduleRetry(error.retryAfterMs);
        emit({ ...baseSnapshot(), status: "rateLimited" });
        return;
    }
    // Network trouble or a server error: exponential backoff with jitter.
    failures++;
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1)) * (0.75 + random() * 0.5);
    scheduleRetry(delay);
    emit({ ...baseSnapshot(), status: error.kind === "network" ? "offline" : "error" });
  }

  async function requestSync(reason: SyncReason): Promise<void> {
    if (disposed || !account) return;
    if (now() < blockedUntil) return; // even a manual sync waits for the backend's back-off
    // A blocked account is only retried when the user asks ("Sync now" / signing in again).
    if (accountBlocked && reason !== "manual" && reason !== "signin") return;
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
        console.warn("[sync] unexpected error", e instanceof Error ? e.name : "");
        emit({ ...baseSnapshot(), status: account ? "error" : "signedOut" });
      } finally {
        running = null;
      }
    })();
    return running;
  }

  function notifyLocalChange() {
    if (disposed || !account || state.conflict || accountBlocked) return;
    clearTimer("debounce");
    debounceTimer = timers.set(() => {
      debounceTimer = null;
      void requestSync("local");
    }, debounceMs);
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

  async function signedIn(a: AccountInfo, notice: SyncNotice) {
    useAccount(a);
    await Promise.all([storage.saveSession(JSON.stringify(a)).catch(() => undefined), persistState()]);
    emit({ ...baseSnapshot(), status: "idle", notice });
    void requestSync("signin");
  }

  return {
    async init() {
      const [rawFlag, rawState] = await Promise.all([
        storage.loadSession().catch(() => null),
        storage.loadState().catch(() => null),
      ]);
      state = parseSyncState(rawState);
      const flag = parseFlag(rawFlag);
      if (rawFlag && !flag) await storage.clearSession().catch(() => undefined);
      if (flag) {
        // Show the account right away (works offline); confirm it with the SDK below.
        account = flag;
        if (state.userId !== flag.uid) state = { ...forgetAccount(state), userId: flag.uid };
      }
      emit({ ...baseSnapshot(), loaded: true, status: account ? (state.conflict ? "conflict" : "idle") : "signedOut" });

      // Guest mode (no flag, no redirect in flight) never loads the backend.
      if (!flag && !deps.redirectPending?.()) return;
      let restored: SyncResult<AccountInfo | null>;
      try {
        restored = await (await ensureBackend()).restore();
      } catch {
        if (account) void requestSync("start"); // will retry loading with backoff
        return;
      }
      if (!restored.ok) {
        if (account) void requestSync("start");
        return;
      }
      const user = restored.value;
      if (!user) {
        if (account) await dropSession("sessionExpired");
        return;
      }
      if (!flag || flag.uid !== user.uid) {
        await signedIn(user, flag ? null : "signedIn"); // finished a redirect sign-in
        return;
      }
      useAccount(user);
      emit(baseSnapshot());
      void requestSync("start");
    },

    dispose() {
      disposed = true;
      stopLive();
      unwatchAuth?.();
      clearTimer("retry");
      clearTimer("debounce");
      listeners.clear();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot: () => snapshot,

    async signIn() {
      let b: SyncBackend;
      try {
        b = await ensureBackend();
      } catch {
        return err({ kind: "network" });
      }
      const r = await b.signIn();
      if (!r.ok) return r;
      await signedIn(r.value, "signedIn");
      return { ok: true, value: undefined };
    },

    async signOut() {
      await dropSession(null);
      // Local data stays; the SDK forgets its credentials.
      if (backend) await backend.signOut().catch(() => undefined);
    },

    async deleteAccount() {
      if (!account) return err({ kind: "unauthorized" });
      let b: SyncBackend;
      try {
        b = await ensureBackend();
      } catch {
        return err({ kind: "network" });
      }
      stopLive();
      const r = await b.deleteAccount();
      if (!r.ok) {
        startLive();
        return r;
      }
      await dropSession("accountDeleted");
      return r;
    },

    requestSync,
    notifyLocalChange,
    resolveConflict,

    setForeground(active) {
      foreground = active;
      if (!active) stopLive();
      else if (account) void requestSync("resume").then(() => startLive());
    },

    async clearHistory() {
      state.history = { arcs: [], habits: [], checkIns: [] };
      await persistState();
      emit(baseSnapshot());
    },

    dismissNotice() {
      emit({ notice: null });
    },
  };
}
