import { describe, expect, test } from "bun:test";
import { deleteHabit, setCheckIn, updateSettings, type AppData } from "../model.ts";
import type { AccountInfo, SyncBackend } from "./backend.ts";
import { createSyncEngine, type SyncStorage, type Timers } from "./engine.ts";
import { err, ok } from "./errors.ts";
import { checkInDocId, createFirestoreTransport } from "./firestoreTransport.ts";
import { toSyncChanges } from "./mapping.ts";
import { createMemoryFirestore, type MemoryFirestore } from "./memoryFirestore.ts";
import { T1, T2, T3, TODAY, makeData } from "./testkit.ts";

const NOW = Date.parse("2026-10-05T12:00:00.000Z");
const USER: AccountInfo = { uid: "u1", email: "yahir@gmail.com" };
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

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
      await tick(20);
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

interface SetupOptions {
  data?: AppData | null;
  fs?: MemoryFirestore;
  live?: boolean;
  pageSize?: number;
  /** What the SDK reports at restore (default: whoever signed in). */
  sdkUser?: AccountInfo | null;
  loadFails?: boolean;
  /** The user closes Google's re-auth popup. */
  deleteCancelled?: boolean;
}

function setup(opts: SetupOptions = {}) {
  const fs = opts.fs ?? createMemoryFirestore({ enforceRules: true });
  let data: AppData | null = opts.data === undefined ? makeData() : opts.data;
  const t = fakeTimers();
  const storage = memoryStorage();
  let sdkUser: AccountInfo | null = opts.sdkUser === undefined ? null : opts.sdkUser;
  const signedOut = new Set<() => void>();
  let loads = 0;
  const backend: SyncBackend = {
    restore: async () => ok(sdkUser),
    signIn: async () => ok((sdkUser = USER)),
    signOut: async () => void (sdkUser = null),
    // Like the real backend: re-auth, then user.delete(); onUserDeleted erases users/{uid} server-side.
    deleteAccount: async () => {
      if (opts.deleteCancelled) return err({ kind: "cancelled" });
      fs.deleteUserData(USER.uid);
      return ok(undefined);
    },
    onSignedOut: (cb) => {
      signedOut.add(cb);
      return () => signedOut.delete(cb);
    },
    transport: (uid) => createFirestoreTransport(fs.port, uid, { now: () => NOW, pageSize: opts.pageSize ?? 300 }),
  };
  const engine = createSyncEngine({
    loadBackend: async () => {
      loads++;
      if (opts.loadFails) throw new Error("chunk failed");
      return backend;
    },
    storage,
    getData: () => data,
    setData: (d) => void (data = d),
    today: () => TODAY,
    now: () => NOW,
    timers: t.timers,
    random: () => 0.5,
  });
  if (opts.live === false) engine.setForeground(false);
  return {
    engine,
    fs,
    storage,
    timers: t,
    get loads() {
      return loads;
    },
    revoke: () => signedOut.forEach((cb) => cb()),
    get data() {
      return data;
    },
    set data(d: AppData | null) {
      data = d;
    },
    async signIn() {
      await engine.init();
      const r = await engine.signIn();
      expect(r.ok).toBe(true);
      await engine.requestSync("manual");
      await tick();
    },
  };
}

const paths = (fs: MemoryFirestore) => [...fs.docs().keys()].sort();

describe("guest mode", () => {
  test("never loads the backend", async () => {
    const s = setup();
    await s.engine.init();
    await s.engine.requestSync("manual");
    s.engine.notifyLocalChange();
    s.engine.setForeground(true);
    expect(s.loads).toBe(0);
    expect(s.engine.getSnapshot()).toMatchObject({ loaded: true, status: "signedOut", account: null });
  });
});

describe("sign-in and first sync", () => {
  test("an empty account gets everything, in the documented layout", async () => {
    const s = setup({ live: false });
    await s.signIn();
    const d = s.data!;
    expect(s.engine.getSnapshot()).toMatchObject({ status: "idle", account: { email: USER.email }, notice: "signedIn" });
    expect(paths(s.fs)).toEqual(
      [
        "users/u1",
        `users/u1/arcs/${d.arc.id}`,
        ...d.habits.map((h) => `users/u1/habits/${h.id}`),
      ].sort(),
    );
    const profile = s.fs.docs().get("users/u1")!;
    expect(profile).toMatchObject({ displayName: "Yahir", locale: "es", currentArcId: d.arc.id });
    expect(typeof profile.createdAt).toBe("string");
    // The flag holds who is signed in, never a credential.
    expect(JSON.parse(s.storage.session!)).toEqual(USER);
  });

  test("a previous session at startup is restored from the SDK", async () => {
    const s = setup({ sdkUser: USER, live: false });
    s.storage.session = JSON.stringify(USER);
    await s.engine.init();
    await tick();
    expect(s.loads).toBe(1);
    expect(s.engine.getSnapshot()).toMatchObject({ account: { email: USER.email } });
  });

  test("…and dropped (data kept) if the SDK no longer has it", async () => {
    const s = setup({ sdkUser: null });
    s.storage.session = JSON.stringify(USER);
    await s.engine.init();
    expect(s.engine.getSnapshot()).toMatchObject({ status: "signedOut", notice: "sessionExpired" });
    expect(s.storage.session).toBeNull();
    expect(s.data).not.toBeNull();
  });

  test("if the SDK chunk can't load (offline), the account stays and it retries", async () => {
    const s = setup({ loadFails: true });
    s.storage.session = JSON.stringify(USER);
    await s.engine.init();
    await tick();
    expect(s.engine.getSnapshot()).toMatchObject({ account: { email: USER.email }, status: "offline" });
    expect(s.timers.pending.size).toBe(1);
  });

  test("second device without data adopts the account's arc; edits flow both ways", async () => {
    const fs = createMemoryFirestore({ enforceRules: true });
    const a = setup({ fs, live: false });
    await a.signIn();
    const b = setup({ fs, data: null, live: false });
    await b.signIn();
    expect(b.data?.arc.id).toBe(a.data!.arc.id);
    const hid = a.data!.habits[1]!.id;
    b.data = setCheckIn(b.data!, hid, "2026-10-04", true, T2);
    await b.engine.requestSync("manual");
    await a.engine.requestSync("manual");
    expect(a.data!.checkIns[`${hid}|2026-10-04`]?.done).toBe(true);
    // Un-check flows back.
    a.data = setCheckIn(a.data!, hid, "2026-10-04", false, "2026-10-05T10:00:00.000Z");
    await a.engine.requestSync("manual");
    await b.engine.requestSync("manual");
    expect(b.data!.checkIns[`${hid}|2026-10-04`]?.done).toBe(false);
  });

  test("paginates with small pages", async () => {
    const fs = createMemoryFirestore({ enforceRules: true });
    const a = setup({ fs, live: false, data: makeData({ habits: 7 }) });
    await a.signIn();
    const b = setup({ fs, live: false, data: null, pageSize: 2 });
    await b.signIn();
    expect(b.data?.habits).toHaveLength(7);
  });
});

describe("conflict on first sign-in", () => {
  async function seeded() {
    const fs = createMemoryFirestore({ enforceRules: true });
    const remote = setup({ fs, live: false, data: makeData({ name: "Remote" }) });
    await remote.signIn();
    const s = setup({ fs, live: false });
    const local = s.data!;
    await s.signIn();
    return { fs, s, local, remote: remote.data! };
  }

  test("asks, pushes nothing, and survives a restart", async () => {
    const { fs, s, local, remote } = await seeded();
    expect(s.engine.getSnapshot()).toMatchObject({ status: "conflict", conflict: { serverArcId: remote.arc.id } });
    expect(s.data).toBe(local);
    expect(fs.docs().has(`users/u1/arcs/${local.arc.id}`)).toBe(false);
    const again = createSyncEngine({
      loadBackend: async () => {
        throw new Error("not needed");
      },
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

  test("keep this device's arc", async () => {
    const { fs, s, local, remote } = await seeded();
    await s.engine.resolveConflict("device");
    await tick();
    expect(s.data!.arc.id).toBe(local.arc.id);
    expect(fs.docs().get("users/u1")!.currentArcId).toBe(local.arc.id);
    expect(fs.docs().has(`users/u1/arcs/${remote.arc.id}`)).toBe(true);
  });

  test("use the account's arc (this device's arc is kept and uploaded)", async () => {
    const { fs, s, local, remote } = await seeded();
    await s.engine.resolveConflict("account");
    await tick();
    expect(s.data!.arc.id).toBe(remote.arc.id);
    expect(s.data!.settings.displayName).toBe("Remote");
    expect(fs.docs().has(`users/u1/arcs/${local.arc.id}`)).toBe(true);
    expect(fs.docs().get("users/u1")!.currentArcId).toBe(remote.arc.id);
  });
});

describe("pushing", () => {
  test("local edits are debounced and only dirty records are written", async () => {
    const s = setup({ live: false });
    await s.signIn();
    const writes = s.fs.stats.writes;
    s.data = setCheckIn(s.data!, s.data!.habits[0]!.id, "2026-10-05", true, T2);
    s.engine.notifyLocalChange();
    s.engine.notifyLocalChange();
    expect([...s.timers.pending.values()].map((p) => p.ms)).toEqual([3000]);
    await s.timers.runAll();
    expect(s.fs.stats.writes - writes).toBe(1);
    expect(s.fs.docs().has(`users/u1/checkIns/${checkInDocId({ habitId: s.data!.habits[0]!.id, date: "2026-10-05" })}`)).toBe(true);
    // Nothing dirty: a local trigger doesn't touch the backend.
    const reads = s.fs.stats.reads;
    s.engine.notifyLocalChange();
    await s.timers.runAll();
    expect(s.fs.stats.reads).toBe(reads);
  });

  test("a rejected batch (another device won meanwhile) is re-pulled and retried once", async () => {
    const s = setup({ live: false });
    await s.signIn();
    s.data = setCheckIn(s.data!, s.data!.habits[0]!.id, "2026-10-05", true, T2);
    // pull = 3 collection queries + the profile read; then the commit is refused once.
    s.fs.failNext(null, null, null, null, "permission-denied");
    await s.engine.requestSync("manual");
    expect(s.engine.getSnapshot().status).toBe("idle");
    expect(s.fs.docs().has(`users/u1/checkIns/${s.data!.habits[0]!.id}_2026-10-05`)).toBe(true);
  });

  test("still rejected after the retry: paused, no loop", async () => {
    const s = setup({ live: false });
    await s.signIn();
    s.data = setCheckIn(s.data!, s.data!.habits[0]!.id, "2026-10-05", true, T2);
    s.fs.port.commit = async () => {
      throw Object.assign(new Error("denied"), { code: "permission-denied" });
    };
    await s.engine.requestSync("manual");
    expect(s.engine.getSnapshot().status).toBe("rejected");
    expect(s.timers.pending.size).toBe(0);
  });

  test("a record that can't be sent stays pending and doesn't block the batch", async () => {
    const s = setup({ live: false });
    await s.signIn();
    const d = s.data!;
    s.data = setCheckIn(setCheckIn(d, d.habits[0]!.id, "2026-10-04", true, "2030-01-01T00:00:00.000Z"), d.habits[1]!.id, "2026-10-04", true, T2);
    await s.engine.requestSync("manual");
    expect(s.fs.docs().has(`users/u1/checkIns/${d.habits[1]!.id}_2026-10-04`)).toBe(true);
    expect(s.fs.docs().has(`users/u1/checkIns/${d.habits[0]!.id}_2026-10-04`)).toBe(false);
    expect(s.engine.getSnapshot().status).toBe("idle");
    expect(s.timers.pending.size).toBe(0);
  });

  test("an invalid emoji is repaired on the way out", async () => {
    const s = setup({ live: false });
    s.data = { ...s.data!, habits: s.data!.habits.map((h, i) => (i === 0 ? { ...h, emoji: "x" } : h)) };
    await s.signIn();
    expect(s.fs.docs().get(`users/u1/habits/${s.data!.habits[0]!.id}`)?.emoji).toBe("🔥");
  });

  test("a newer profile from another device is applied", async () => {
    const fs = createMemoryFirestore({ enforceRules: true });
    const a = setup({ fs, live: false });
    await a.signIn();
    const b = setup({ fs, live: false, data: null });
    await b.signIn();
    a.data = updateSettings(a.data!, { displayName: "Renamed" }, T2);
    await a.engine.requestSync("manual");
    await b.engine.requestSync("manual");
    expect(b.data!.settings.displayName).toBe("Renamed");
  });
});

describe("errors", () => {
  test("unavailable: offline + exponential backoff, then recovers", async () => {
    const s = setup({ live: false });
    await s.signIn();
    s.fs.failNext("unavailable", null, null, null, "unavailable", null, null, null); // one pull = 4 port calls
    await s.engine.requestSync("manual");
    expect(s.engine.getSnapshot().status).toBe("offline");
    const first = [...s.timers.pending.values()][0]!.ms;
    await s.timers.runAll();
    expect([...s.timers.pending.values()][0]!.ms).toBe(first * 2);
    await s.timers.runAll();
    expect(s.engine.getSnapshot().status).toBe("idle");
  });

  test("resource-exhausted: waits before retrying, even manual syncs", async () => {
    const s = setup({ live: false });
    await s.signIn();
    s.fs.failNext("resource-exhausted");
    await s.engine.requestSync("manual");
    expect(s.engine.getSnapshot().status).toBe("rateLimited");
    const reads = s.fs.stats.reads;
    await s.engine.requestSync("manual");
    expect(s.fs.stats.reads).toBe(reads);
  });

  test("unauthenticated or a revoked session: signed out, data kept", async () => {
    const s = setup({ live: false });
    await s.signIn();
    s.fs.failNext("unauthenticated");
    await s.engine.requestSync("manual");
    expect(s.engine.getSnapshot()).toMatchObject({ status: "signedOut", notice: "sessionExpired" });
    expect(s.data).not.toBeNull();

    const r = setup({ live: false });
    await r.signIn();
    r.revoke();
    await tick();
    expect(r.engine.getSnapshot().status).toBe("signedOut");
  });

  test("single flight", async () => {
    const s = setup({ live: false });
    await s.engine.init();
    await s.engine.signIn();
    let inFlight = 0;
    let max = 0;
    const pull = s.fs.port.queryAfter;
    s.fs.port.queryAfter = async (...args) => {
      max = Math.max(max, ++inFlight);
      await tick(2);
      inFlight--;
      return pull(...args);
    };
    await Promise.all([s.engine.requestSync("manual"), s.engine.requestSync("resume"), s.engine.requestSync("online")]);
    expect(max).toBeLessThanOrEqual(3); // the 3 collections of one pull, never two pulls at once
  });
});

describe("realtime", () => {
  test("another device's change arrives without a manual sync, and detaches in the background", async () => {
    const fs = createMemoryFirestore({ enforceRules: true });
    const a = setup({ fs });
    await a.signIn();
    expect(a.engine.getSnapshot().live).toBe(true);
    const b = setup({ fs, live: false, data: null });
    await b.signIn();
    const [h0, h1] = a.data!.habits.map((h) => h.id);
    b.data = setCheckIn(b.data!, h0!, "2026-10-05", true, T2);
    await b.engine.requestSync("manual");
    await tick(20);
    expect(a.data!.checkIns[`${h0}|2026-10-05`]?.done).toBe(true);

    a.engine.setForeground(false);
    expect(a.engine.getSnapshot().live).toBe(false);
    b.data = setCheckIn(b.data!, h1!, "2026-10-05", true, T2);
    await b.engine.requestSync("manual");
    await tick(20);
    expect(a.data!.checkIns[`${h1}|2026-10-05`]).toBeUndefined();
    a.engine.setForeground(true);
    await tick(30);
    expect(a.data!.checkIns[`${h1}|2026-10-05`]?.done).toBe(true);
    expect(a.engine.getSnapshot().live).toBe(true);
  });
});

describe("tombstoned parents", () => {
  test("check in, then delete the habit before syncing: the tombstone syncs, the orphan check-in is settled", async () => {
    const s = setup({ live: false });
    await s.signIn();
    const hid = s.data!.habits[0]!.id;
    s.data = setCheckIn(s.data!, hid, TODAY, true, T2);
    s.data = deleteHabit(s.data!, hid, T3);
    await s.engine.requestSync("manual");
    expect(s.engine.getSnapshot().status).toBe("idle");
    const docs = s.fs.docs();
    expect(docs.get(`users/${USER.uid}/habits/${hid}`)?.deletedAt).toBe(T3);
    expect(docs.has(`users/${USER.uid}/checkIns/${checkInDocId({ habitId: hid, date: TODAY })}`)).toBe(false);
    const commits = s.fs.stats.commits;
    s.engine.notifyLocalChange();
    await s.timers.runAll();
    await s.engine.requestSync("local");
    expect(s.fs.stats.commits).toBe(commits); // nothing left to push
  });
});

describe("blocked accounts", () => {
  test("a blocked account (reads refused) stops syncing with 'blocked', no retry loop", async () => {
    const s = setup();
    await s.signIn();
    expect(s.engine.getSnapshot().status).toBe("idle");
    s.fs.setBlocked(USER.uid, true);
    s.data = setCheckIn(s.data!, s.data!.habits[0]!.id, TODAY, true, T3);
    s.engine.notifyLocalChange();
    await s.timers.runAll();
    await tick(20);
    expect(s.engine.getSnapshot()).toMatchObject({ status: "blocked", live: false });
    const reads = s.fs.stats.reads;
    // Further edits, resumes and timers don't hammer the server.
    s.data = setCheckIn(s.data!, s.data!.habits[1]!.id, TODAY, true, T3);
    s.engine.notifyLocalChange();
    await s.engine.requestSync("resume");
    await s.engine.requestSync("retry");
    await s.timers.runAll();
    expect(s.timers.pending.size).toBe(0);
    expect(s.fs.stats.reads).toBe(reads);
    // A manual "Sync now" tries again; once unblocked it recovers.
    s.fs.setBlocked(USER.uid, false);
    await s.engine.requestSync("manual");
    expect(s.engine.getSnapshot().status).toBe("idle");
  });
});

describe("account", () => {
  test("delete: re-auth + user.delete(); the server erases the data (onUserDeleted); local data stays", async () => {
    const s = setup();
    await s.signIn();
    expect(paths(s.fs).length).toBeGreaterThan(0);
    const r = await s.engine.deleteAccount();
    expect(r.ok).toBe(true);
    expect(paths(s.fs)).toEqual([]);
    expect(s.engine.getSnapshot()).toMatchObject({ status: "signedOut", notice: "accountDeleted", live: false });
    expect(s.data).not.toBeNull();
  });

  test("a cancelled re-auth deletes nothing and keeps the session", async () => {
    const s = setup({ live: false, deleteCancelled: true });
    await s.signIn();
    const before = paths(s.fs);
    expect(await s.engine.deleteAccount()).toEqual({ ok: false, error: { kind: "cancelled" } });
    expect(paths(s.fs)).toEqual(before);
    expect(s.engine.getSnapshot().account).toEqual({ email: USER.email });
  });

  test("sign out keeps data and forgets the cursor", async () => {
    const s = setup();
    await s.signIn();
    await s.engine.signOut();
    expect(s.engine.getSnapshot()).toMatchObject({ status: "signedOut", live: false });
    expect(JSON.parse(s.storage.state!).cursor).toBeNull();
    expect(s.storage.session).toBeNull();
    expect(s.data).not.toBeNull();
  });

  test("after a reset (no local data, already synced) the account's arc is not forced back", async () => {
    const s = setup({ live: false });
    await s.signIn();
    s.data = null;
    await s.engine.requestSync("manual");
    expect(s.data).toBeNull();
  });
});

test("pushes are validated with the shared rules (fixture sanity)", () => {
  expect(toSyncChanges(makeData()).habits.length).toBe(2);
  expect(T1 < T2).toBe(true);
});
