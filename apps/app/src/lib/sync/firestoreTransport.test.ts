import { describe, expect, test } from "bun:test";
import { emptyChanges } from "@cold-forge/sync";
import {
  checkInDocId,
  createFirestoreTransport,
  decodeCursor,
  encodeCursor,
  mapFirestoreError,
  maxCursor,
} from "./firestoreTransport.ts";
import { toSyncChanges } from "./mapping.ts";
import { createMemoryFirestore } from "./memoryFirestore.ts";
import { T0, T1, makeData } from "./testkit.ts";

const NOW = Date.parse("2026-10-05T12:00:00.000Z");
const mk = (pageSize = 300) => {
  const fs = createMemoryFirestore({ enforceRules: true });
  return { fs, t: createFirestoreTransport(fs.port, "u1", { now: () => NOW, pageSize }) };
};

describe("cursor", () => {
  test("round-trips and takes the later position per collection", () => {
    const a = encodeCursor({ arcs: { at: { seconds: 5, nanos: 0 }, id: "x" }, habits: null, checkIns: null, profile: null });
    const b = encodeCursor({ arcs: { at: { seconds: 5, nanos: 0 }, id: "y" }, habits: { at: { seconds: 1, nanos: 2 }, id: "h" }, checkIns: null, profile: { seconds: 9, nanos: 0 } });
    expect(decodeCursor(a).arcs).toEqual({ at: { seconds: 5, nanos: 0 }, id: "x" });
    const m = decodeCursor(maxCursor(a, b));
    expect(m.arcs?.id).toBe("y"); // same time, later id
    expect(m.habits?.id).toBe("h");
    expect(m.profile).toEqual({ seconds: 9, nanos: 0 });
    expect(decodeCursor("garbage")).toEqual({ arcs: null, habits: null, checkIns: null, profile: null });
    expect(decodeCursor(JSON.stringify({ v: 1, a: [1, 2, { evil: true }] })).arcs).toBeNull();
  });
});

describe("push and pull", () => {
  test("writes the documented paths; pulls everything back, paging through ties", async () => {
    const { fs, t } = mk(2);
    const d = makeData({ habits: 5 });
    const c = toSyncChanges(d);
    c.checkIns = [{ habitId: d.habits[0]!.id, date: "2026-10-01", done: true, updatedAt: T1 }];
    expect((await t.pull(null)).ok).toBe(true); // learns the profile doesn't exist yet
    expect((await t.push(c)).ok).toBe(true);
    expect(fs.docs().has(`users/u1/checkIns/${checkInDocId(c.checkIns[0]!)}`)).toBe(true);
    expect(typeof fs.docs().get("users/u1")!.createdAt).toBe("string");

    // All 8 docs share one commit time: pages of 2 must still return each exactly once.
    let cursor: string | null = null;
    const got = emptyChanges();
    for (let i = 0; i < 10; i++) {
      const r = await t.pull(cursor);
      if (!r.ok) throw new Error("pull failed");
      got.arcs.push(...r.value.changes.arcs);
      got.habits.push(...r.value.changes.habits);
      got.checkIns.push(...r.value.changes.checkIns);
      if (r.value.changes.profile) got.profile = r.value.changes.profile;
      cursor = r.value.cursor;
      if (!r.value.hasMore) break;
    }
    expect(got.arcs).toEqual(c.arcs);
    expect(new Set(got.habits.map((h) => h.id))).toEqual(new Set(c.habits.map((h) => h.id)));
    expect(got.checkIns).toEqual(c.checkIns);
    expect(got.profile).toEqual(c.profile);
    // Nothing new after the cursor.
    const again = await t.pull(cursor);
    expect(again.ok && again.value.changes).toEqual(emptyChanges());
  });

  test("an existing profile is merged without createdAt, so it is never overwritten", async () => {
    const { fs, t } = mk();
    const c = toSyncChanges(makeData());
    await t.pull(null);
    await t.push(c);
    const created = fs.docs().get("users/u1")!.createdAt;
    await t.pull(null);
    await t.push({ ...emptyChanges(), profile: { ...c.profile!, displayName: "New", updatedAt: T1 } });
    expect(fs.docs().get("users/u1")).toMatchObject({ displayName: "New", createdAt: created });
  });

  test("server docs are untrusted: invalid or mismatched ones are skipped, the cursor still moves", async () => {
    const { fs, t } = mk();
    const good = toSyncChanges(makeData()).habits[0]!;
    let invalid = 0;
    const tr = createFirestoreTransport(fs.port, "u1", { now: () => NOW, onInvalidDocs: (n) => (invalid += n) });
    await fs.commit([
      { kind: "set", path: `users/u1/arcs/${good.arcId}`, data: { ...toSyncChanges(makeData()).arcs[0]!, id: good.arcId } },
    ]);
    await fs.commit([
      { kind: "set", path: `users/u1/habits/${good.id}`, data: { ...good } },
      { kind: "set", path: "users/u1/habits/00000000-0000-4000-8000-0000000000aa", data: { ...good } }, // id mismatch
      { kind: "set", path: "users/u1/habits/00000000-0000-4000-8000-0000000000bb", data: { ...good, id: "00000000-0000-4000-8000-0000000000bb", name: "x‮y" } },
    ]);
    const r = await tr.pull(null);
    expect(r.ok && r.value.changes.habits.map((h) => h.id)).toEqual([good.id]);
    expect(invalid).toBe(2);
    const next = await tr.pull(r.ok ? r.value.cursor : null);
    expect(next.ok && next.value.changes.habits).toEqual([]);
    expect(t).toBeDefined();
  });

  test("stale writes are refused (rules mimic), mapped to rejected", async () => {
    const { t } = mk();
    const c = toSyncChanges(makeData());
    await t.pull(null);
    await t.push(c);
    const stale = { ...emptyChanges(), arcs: [{ ...c.arcs[0]!, why: "older", updatedAt: T0 }] };
    expect(await t.push(stale)).toEqual({ ok: false, error: { kind: "rejected" } });
  });

  test("deleteEverything removes all of the user's documents", async () => {
    const { fs, t } = mk();
    await t.pull(null);
    await t.push(toSyncChanges(makeData()));
    expect((await t.deleteEverything()).ok).toBe(true);
    expect(fs.docs().size).toBe(0);
  });
});

test("Firestore error codes map to engine behaviour", () => {
  expect(mapFirestoreError({ code: "permission-denied" })).toEqual({ kind: "rejected" });
  expect(mapFirestoreError({ code: "unavailable" })).toEqual({ kind: "network" });
  expect(mapFirestoreError({ code: "resource-exhausted" })).toEqual({ kind: "rate_limited", retryAfterMs: 60_000 });
  expect(mapFirestoreError({ code: "unauthenticated" })).toEqual({ kind: "unauthorized" });
  expect(mapFirestoreError(new Error("x"))).toEqual({ kind: "server" });
});
