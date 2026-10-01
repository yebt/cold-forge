import { describe, expect, test } from "bun:test";
import {
  checkInKey as syncKey,
  emptyChanges,
  incomingWins,
  type SessionResponse,
  type SyncChanges,
  type SyncRequest,
} from "@cold-forge/sync";
import { setCheckIn, updateSettings, type AppData } from "../model.ts";
import type { ApiClient, ApiError, ApiResult } from "./api.ts";
import { createSyncEngine, type SyncStorage, type Timers } from "./engine.ts";
import { toSyncChanges } from "./mapping.ts";
import type { SyncPage } from "./validate.ts";
import { T1, T2, TODAY, makeData } from "./testkit.ts";

const NOW = Date.parse("2026-10-05T12:00:00.000Z");

/** Minimal LWW server with a seq-based cursor and paging, like the real API. */
function fakeServer(pageSize = 1000) {
  let seq = 0;
  type Row<T> = { r: T; seq: number };
  const arcs = new Map<string, Row<SyncChanges["arcs"][number]>>();
  const habits = new Map<string, Row<SyncChanges["habits"][number]>>();
  const checkIns = new Map<string, Row<SyncChanges["checkIns"][number]>>();
  let profile: Row<NonNullable<SyncChanges["profile"]>> | null = null;
  const requests: SyncRequest[] = [];
  let failNext: ApiError[] = [];
  let inFlight = 0;
  let maxInFlight = 0;

  function put<T extends { updatedAt: string }>(map: Map<string, Row<T>>, key: string, r: T) {
    if (incomingWins(map.get(key)?.r, r)) map.set(key, { r, seq: ++seq });
  }

  const snapshot = (): SyncChanges => ({
    arcs: [...arcs.values()].map((x) => x.r),
    habits: [...habits.values()].map((x) => x.r),
    checkIns: [...checkIns.values()].map((x) => x.r),
    profile: profile?.r ?? null,
  });

  async function sync(_token: string, req: SyncRequest): Promise<ApiResult<SyncPage>> {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    requests.push(structuredClone(req));
    const err = failNext.shift();
    if (err) return { ok: false, error: err };
    for (const a of req.changes.arcs) put(arcs, a.id, a);
    for (const h of req.changes.habits) put(habits, h.id, h);
    for (const c of req.changes.checkIns) put(checkIns, syncKey(c), c);
    if (req.changes.profile && incomingWins(profile?.r, req.changes.profile)) profile = { r: req.changes.profile, seq: ++seq };
    const after = req.cursor ? Number(req.cursor) : 0;
    type Item = { seq: number; add: (c: SyncChanges) => void };
    const items: Item[] = [
      ...[...arcs.values()].map((x) => ({ seq: x.seq, add: (c: SyncChanges) => void c.arcs.push(x.r) })),
      ...[...habits.values()].map((x) => ({ seq: x.seq, add: (c: SyncChanges) => void c.habits.push(x.r) })),
      ...[...checkIns.values()].map((x) => ({ seq: x.seq, add: (c: SyncChanges) => void c.checkIns.push(x.r) })),
      ...(profile ? [{ seq: profile.seq, add: (c: SyncChanges) => void (c.profile = profile!.r) }] : []),
    ]
      .filter((i) => i.seq > after)
      .sort((a, b) => a.seq - b.seq);
    const pageItems = items.slice(0, pageSize);
    const changes = emptyChanges();
    pageItems.forEach((i) => i.add(changes));
    const cursor = String(pageItems.length ? pageItems[pageItems.length - 1]!.seq : Math.max(after, seq));
    return {
      ok: true,
      value: { cursor, changes, serverTime: new Date(NOW).toISOString(), hasMore: items.length > pageItems.length },
    };
  }

  return {
    sync,
    snapshot,
    requests,
    fail: (...e: ApiError[]) => (failNext = e),
    get maxInFlight() {
      return maxInFlight;
    },
    seed(c: SyncChanges) {
      return sync("t", { protocol: 1, cursor: null, changes: c });
    },
  };
}

function fakeTimers() {
  const pending = new Map<number, { fn: () => void; ms: number }>();
  let id = 0;
  const timers: Timers = {
    set: (fn, ms) => {
      pending.set(++id, { fn, ms });
      return id;
    },
    clear: (h) => void pending.delete(h as number),
  };
  return {
    timers,
    pending,
    async runAll() {
      const list = [...pending.values()];
      pending.clear();
      for (const t of list) t.fn();
      await new Promise((r) => setTimeout(r, 20));
    },
  };
}

function memoryStorage(): SyncStorage & { session: string | null; state: string | null } {
  const s = {
    session: null as string | null,
    state: null as string | null,
    loadSession: async () => s.session,
    saveSession: async (v: string) => void (s.session = v),
    clearSession: async () => void (s.session = null),
    loadState: async () => s.state,
    saveState: async (v: string) => void (s.state = v),
  };
  return s;
}

const SESSION: SessionResponse = {
  token: "tok_" + "x".repeat(40),
  expiresAt: "2026-12-01T00:00:00.000Z",
  user: { id: "usr_1", email: "yahir@example.com" },
};

function setup(opts: { data?: AppData | null; server?: ReturnType<typeof fakeServer>; deleteResult?: ApiResult<void> } = {}) {
  const server = opts.server ?? fakeServer();
  let data: AppData | null = opts.data === undefined ? makeData() : opts.data;
  const t = fakeTimers();
  const storage = memoryStorage();
  const logouts: string[] = [];
  const api: ApiClient = {
    baseUrl: "https://x.dev",
    requestMagicLink: async () => ({ ok: true, value: { requestId: "x" } }),
    verify: async () => ({ ok: true, value: SESSION }),
    logout: async (token) => {
      logouts.push(token);
      return { ok: true, value: undefined };
    },
    deleteAccount: async () => opts.deleteResult ?? { ok: true, value: undefined },
    sync: server.sync,
  };
  const engine = createSyncEngine({
    api,
    storage,
    getData: () => data,
    setData: (d) => void (data = d),
    today: () => TODAY,
    now: () => NOW,
    timers: t.timers,
    random: () => 0.5,
  });
  return {
    engine,
    server,
    storage,
    logouts,
    timers: t,
    get data() {
      return data;
    },
    set data(d: AppData | null) {
      data = d;
    },
    async signIn() {
      await engine.init();
      await engine.signIn(SESSION);
      await engine.requestSync("manual");
    },
  };
}

describe("sync engine", () => {
  test("first sign-in with an empty account pushes everything", async () => {
    const s = setup();
    await s.signIn();
    const snap = s.engine.getSnapshot();
    expect(snap.status).toBe("idle");
    expect(snap.account).toEqual({ email: "yahir@example.com" });
    expect(snap.lastSyncedAt).toBe(new Date(NOW).toISOString());
    const server = s.server.snapshot();
    expect(server.arcs.map((a) => a.id)).toEqual([s.data!.arc.id]);
    expect(server.habits).toHaveLength(2);
    expect(server.profile?.currentArcId).toBe(s.data!.arc.id);
    expect(JSON.parse(s.storage.session!).token).toBe(SESSION.token);
  });

  test("local edits are debounced and only dirty records are pushed", async () => {
    const s = setup();
    await s.signIn();
    const before = s.server.requests.length;
    s.data = setCheckIn(s.data!, s.data!.habits[0]!.id, "2026-10-05", true, T2);
    s.engine.notifyLocalChange();
    s.engine.notifyLocalChange();
    expect(s.timers.pending.size).toBe(1);
    expect([...s.timers.pending.values()][0]!.ms).toBe(3000);
    await s.timers.runAll();
    const pushed = s.server.requests.slice(before);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.changes.checkIns).toHaveLength(1);
    expect(pushed[0]!.changes.habits).toHaveLength(0);
    expect(pushed[0]!.changes.profile).toBeNull();
    // Nothing dirty: a local trigger doesn't hit the network.
    s.engine.notifyLocalChange();
    await s.timers.runAll();
    expect(s.server.requests.length).toBe(before + 1);
  });

  test("a second device without data adopts the account's arc; edits flow both ways", async () => {
    const server = fakeServer();
    const a = setup({ server });
    await a.signIn();
    const b = setup({ server, data: null });
    await b.signIn();
    expect(b.data?.arc.id).toBe(a.data!.arc.id);
    expect(b.engine.getSnapshot().status).toBe("idle");

    b.data = setCheckIn(b.data!, b.data!.habits[1]!.id, "2026-10-04", true, T2);
    await b.engine.requestSync("manual");
    await a.engine.requestSync("manual");
    expect(a.data!.checkIns[`${a.data!.habits[1]!.id}|2026-10-04`]?.done).toBe(true);
  });

  test("paginates with hasMore until done", async () => {
    const server = fakeServer(2);
    const a = setup({ server });
    await a.signIn();
    const b = setup({ server, data: null });
    await b.signIn();
    expect(b.data?.habits).toHaveLength(2);
    // Every pull after the first page carries the newest cursor.
    const cursors = server.requests.slice(-4).map((r) => r.cursor);
    expect(new Set(cursors).size).toBeGreaterThan(1);
  });

  test("first sign-in with a different arc on the account asks, then keeps this device's arc", async () => {
    const server = fakeServer();
    const remote = setCheckIn(makeData({ name: "Remote" }), makeData().habits[0]!.id, "2026-10-01", true, T1);
    await server.seed(toSyncChanges(remote));
    const s = setup({ server });
    const local = s.data!;
    await s.signIn();
    const snap = s.engine.getSnapshot();
    expect(snap.status).toBe("conflict");
    expect(snap.conflict?.serverArcId).toBe(remote.arc.id);
    expect(snap.conflict?.server).toMatchObject({ habits: 2, startDate: "2026-10-01" });
    expect(s.data).toBe(local); // nothing changed yet
    // No pushes while undecided.
    expect(server.requests.every((r) => r.changes.arcs.length === 0 || r.changes.arcs[0]!.id === remote.arc.id)).toBe(true);

    await s.engine.resolveConflict("device");
    await s.engine.requestSync("manual");
    expect(s.engine.getSnapshot().status).toBe("idle");
    expect(s.data!.arc.id).toBe(local.arc.id);
    const after = server.snapshot();
    expect(after.profile?.currentArcId).toBe(local.arc.id);
    expect(after.arcs.map((a) => a.id).sort()).toEqual([local.arc.id, remote.arc.id].sort());
  });

  test("…or switches to the account's arc and keeps this device's arc as history", async () => {
    const server = fakeServer();
    const remote = makeData({ name: "Remote" });
    await server.seed(toSyncChanges(remote));
    const s = setup({ server });
    const local = s.data!;
    await s.signIn();
    await s.engine.resolveConflict("account");
    await s.engine.requestSync("manual");
    expect(s.data!.arc.id).toBe(remote.arc.id);
    expect(s.data!.settings.displayName).toBe("Remote");
    expect(s.engine.getSnapshot().status).toBe("idle");
    // The device's arc was uploaded too, so nothing is lost.
    expect(server.snapshot().arcs.map((a) => a.id)).toContain(local.arc.id);
    expect(server.snapshot().profile?.currentArcId).toBe(remote.arc.id);
  });

  test("the conflict survives a restart", async () => {
    const server = fakeServer();
    await server.seed(toSyncChanges(makeData()));
    const s = setup({ server });
    await s.signIn();
    const again = createSyncEngine({
      api: { ...s.engine.api },
      storage: s.storage,
      getData: () => s.data,
      setData: () => undefined,
      today: () => TODAY,
      now: () => NOW,
      timers: fakeTimers().timers,
    });
    await again.init();
    expect(again.getSnapshot().status).toBe("conflict");
  });

  test("401 signs out but keeps local data", async () => {
    const s = setup();
    await s.signIn();
    const data = s.data;
    s.server.fail({ kind: "unauthorized" });
    await s.engine.requestSync("manual");
    const snap = s.engine.getSnapshot();
    expect(snap.status).toBe("signedOut");
    expect(snap.notice).toBe("sessionExpired");
    expect(snap.account).toBeNull();
    expect(s.storage.session).toBeNull();
    expect(s.data).toBe(data);
  });

  test("429 waits for Retry-After, even for manual syncs", async () => {
    const s = setup();
    await s.signIn();
    const n = s.server.requests.length;
    s.server.fail({ kind: "rate_limited", retryAfterMs: 30_000 });
    await s.engine.requestSync("manual");
    expect(s.engine.getSnapshot().status).toBe("rateLimited");
    expect([...s.timers.pending.values()].map((t) => t.ms)).toContain(30_000);
    await s.engine.requestSync("manual");
    expect(s.server.requests.length).toBe(n + 1);
  });

  test("offline: exponential backoff, then recovers", async () => {
    const s = setup();
    await s.signIn();
    s.server.fail({ kind: "network" }, { kind: "network" });
    await s.engine.requestSync("manual");
    expect(s.engine.getSnapshot().status).toBe("offline");
    const first = [...s.timers.pending.values()][0]!.ms;
    await s.timers.runAll(); // retry fails again
    const second = [...s.timers.pending.values()][0]!.ms;
    expect(second).toBe(first * 2);
    await s.timers.runAll(); // succeeds
    expect(s.engine.getSnapshot().status).toBe("idle");
  });

  test("single flight: concurrent triggers never overlap", async () => {
    const s = setup();
    await s.engine.init();
    await s.engine.signIn(SESSION);
    await Promise.all([s.engine.requestSync("manual"), s.engine.requestSync("resume"), s.engine.requestSync("online")]);
    expect(s.server.maxInFlight).toBe(1);
  });

  test("a newer profile from another device is applied", async () => {
    const server = fakeServer();
    const a = setup({ server });
    await a.signIn();
    const b = setup({ server, data: null });
    await b.signIn();
    a.data = updateSettings(a.data!, { displayName: "Renamed" }, T2);
    await a.engine.requestSync("manual");
    await b.engine.requestSync("manual");
    expect(b.data!.settings.displayName).toBe("Renamed");
  });

  test("delete account signs out and keeps local data; failures are reported", async () => {
    const s = setup();
    await s.signIn();
    const data = s.data;
    expect((await s.engine.deleteAccount()).ok).toBe(true);
    expect(s.engine.getSnapshot()).toMatchObject({ status: "signedOut", notice: "accountDeleted" });
    expect(s.data).toBe(data);

    const f = setup({ deleteResult: { ok: false, error: { kind: "network" } } });
    await f.signIn();
    expect((await f.engine.deleteAccount()).ok).toBe(false);
    expect(f.engine.getSnapshot().status).toBe("idle");
  });

  test("sign out keeps data and forgets the cursor", async () => {
    const s = setup();
    await s.signIn();
    await s.engine.signOut();
    expect(s.engine.getSnapshot().status).toBe("signedOut");
    expect(JSON.parse(s.storage.state!).cursor).toBeNull();
    expect(s.data).not.toBeNull();
  });

  test("an expired stored session is dropped at startup", async () => {
    const s = setup();
    s.storage.session = JSON.stringify({ ...SESSION, expiresAt: "2026-01-01T00:00:00.000Z" });
    await s.engine.init();
    expect(s.engine.getSnapshot().status).toBe("signedOut");
    expect(s.storage.session).toBeNull();
  });
});

describe("sync engine: server-side resets and quotas", () => {
  test("invalid_cursor starts over from a null cursor", async () => {
    const s = setup();
    await s.signIn();
    const n = s.server.requests.length;
    s.server.fail({ kind: "invalid_cursor" });
    await s.engine.requestSync("manual");
    const after = s.server.requests.slice(n);
    expect(after[0]!.cursor).not.toBeNull(); // the rejected one
    expect(after[1]!.cursor).toBeNull(); // first-sync pull
    // Everything the server still has came back in the pull, so it is acked again, not re-sent.
    expect(after.slice(1).every((r) => r.changes.arcs.length === 0)).toBe(true);
    expect(s.engine.getSnapshot().status).toBe("idle");
  });

  test("quota_exceeded stops automatic retries", async () => {
    const s = setup();
    await s.signIn();
    s.server.fail({ kind: "quota_exceeded" });
    await s.engine.requestSync("manual");
    expect(s.engine.getSnapshot().status).toBe("quota");
    expect(s.timers.pending.size).toBe(0);
  });
});

test("after a reset (no local data, already synced) the account's arc is not forced back", async () => {
  const s = setup();
  await s.signIn();
  s.data = null;
  await s.engine.requestSync("manual");
  expect(s.data).toBeNull();
});

describe("sign-in links (login-CSRF guard)", () => {
  test("a link is held in memory until the user confirms it", async () => {
    const s = setup();
    await s.engine.init();
    await s.engine.signInWithLinkToken("L".repeat(43));
    expect(s.engine.getSnapshot().pendingLink).toEqual({ email: "yahir@example.com" });
    expect(s.engine.getSnapshot().account).toBeNull();
    expect(s.storage.session).toBeNull();
    expect(s.server.requests).toHaveLength(0); // nothing uploaded
    await s.engine.confirmLink();
    await s.engine.requestSync("manual");
    expect(s.engine.getSnapshot()).toMatchObject({ pendingLink: null, account: { email: "yahir@example.com" }, status: "idle" });
    expect(s.storage.session).not.toBeNull();
    expect(s.server.snapshot().arcs).toHaveLength(1);
  });

  test("cancel revokes the link's session and links nothing", async () => {
    const s = setup();
    await s.engine.init();
    await s.engine.signInWithLinkToken("L".repeat(43));
    await s.engine.cancelLink();
    expect(s.engine.getSnapshot()).toMatchObject({ pendingLink: null, account: null, status: "signedOut" });
    expect(s.logouts).toEqual([SESSION.token]);
    expect(s.storage.session).toBeNull();
    expect(s.server.requests).toHaveLength(0);
  });

  test("no dialog when this app just asked for a code for the same email", async () => {
    const s = setup();
    await s.engine.init();
    s.engine.noteCodeRequested("Yahir@Example.com");
    await s.engine.signInWithLinkToken("L".repeat(43));
    expect(s.engine.getSnapshot().pendingLink).toBeNull();
    expect(s.engine.getSnapshot().account).toEqual({ email: "yahir@example.com" });
  });

  test("a code requested for another email still asks", async () => {
    const s = setup();
    await s.engine.init();
    s.engine.noteCodeRequested("someone@else.com");
    await s.engine.signInWithLinkToken("L".repeat(43));
    expect(s.engine.getSnapshot().pendingLink).toEqual({ email: "yahir@example.com" });
  });
});
