import { describe, expect, test } from "bun:test";
import { emptyChanges, type SyncCheckIn } from "@cold-forge/sync";
import { setCheckIn, updateSettings } from "../model.ts";
import { decideFirstSync, summarizeServerArc } from "./conflict.ts";
import { collectDirty, countRecords, isEmpty, markAcked, splitBatches } from "./dirty.ts";
import { emptyHistory, localRecords, toSyncChanges } from "./mapping.ts";
import { emptySyncState, forgetAccount, parseSyncState, serializeSyncState } from "./state.ts";
import { T0, T1, T2, makeData, uid } from "./testkit.ts";

describe("dirty tracking", () => {
  test("everything is dirty before the first ack, nothing after", () => {
    const d = makeData();
    const acked = new Map<string, string>();
    const all = localRecords(d, emptyHistory());
    expect(countRecords(collectDirty(all, acked))).toBe(1 + 2 + 1);
    markAcked(acked, all);
    expect(isEmpty(collectDirty(all, acked))).toBe(true);
  });

  test("only edited records become dirty", () => {
    const d = makeData();
    const acked = new Map<string, string>();
    markAcked(acked, toSyncChanges(d));
    const next = setCheckIn(d, d.habits[0]!.id, "2026-10-01", true, T1);
    const dirty = collectDirty(toSyncChanges(next), acked);
    expect(dirty.checkIns).toHaveLength(1);
    expect(dirty.habits).toHaveLength(0);
    expect(dirty.profile).toBeNull();
  });

  test("is correct when the clock goes backwards (version compare, not a watermark)", () => {
    const d = setCheckIn(makeData(), makeData().habits[0]!.id, "2026-10-01", true, T2);
    const acked = new Map<string, string>();
    markAcked(acked, toSyncChanges(d));
    // The device clock was moved back a day: the new edit has an *older* timestamp.
    const back = setCheckIn(d, d.habits[0]!.id, "2026-10-02", true, T1);
    expect(collectDirty(toSyncChanges(back), acked).checkIns).toHaveLength(1);
    const profileBack = updateSettings(d, { displayName: "Back" }, "2026-09-01T00:00:00.000Z");
    expect(collectDirty(toSyncChanges(profileBack), acked).profile?.displayName).toBe("Back");
  });

  test("edits made while a push is in flight stay dirty", () => {
    const d = makeData();
    const acked = new Map<string, string>();
    const pushed = collectDirty(toSyncChanges(d), acked);
    const edited = setCheckIn(d, d.habits[0]!.id, "2026-10-01", true, T1);
    markAcked(acked, pushed);
    expect(collectDirty(toSyncChanges(edited), acked).checkIns).toHaveLength(1);
  });

  test("splits pushes into atomic writes, parents first", () => {
    const habitId = uid();
    const checkIns: SyncCheckIn[] = Array.from({ length: 900 }, (_, i) => ({
      habitId,
      date: `2026-10-01`,
      done: i % 2 === 0,
      updatedAt: T0,
    }));
    const d = toSyncChanges(makeData());
    const batches = splitBatches({ ...d, checkIns }, 450);
    expect(batches).toHaveLength(3); // 1 profile + 1 arc + 2 habits + 900 check-ins = 904
    expect(batches[0]!.arcs).toHaveLength(1);
    expect(batches[0]!.habits).toHaveLength(2);
    expect(batches[0]!.profile).not.toBeNull();
    expect(batches.every((b) => b.arcs.length + b.habits.length + b.checkIns.length + (b.profile ? 1 : 0) <= 450)).toBe(true);
    expect(batches.reduce((n, b) => n + b.checkIns.length, 0)).toBe(checkIns.length);
    expect(splitBatches(emptyChanges(), 450)).toEqual([]);
  });

  test("caps distinct parents per write (Firestore rules lookup limit)", () => {
    const checkIns: SyncCheckIn[] = Array.from({ length: 40 }, (_, i) => ({
      habitId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      date: "2026-10-01",
      done: true,
      updatedAt: T0,
    }));
    const batches = splitBatches({ ...emptyChanges(), checkIns }, 450, 15);
    expect(batches.map((b) => new Set(b.checkIns.map((c) => c.habitId)).size)).toEqual([15, 15, 10]);
  });
});

describe("first sign-in decision", () => {
  const local = makeData();
  test("empty account: push", () => {
    expect(decideFirstSync(local, emptyChanges())).toEqual({ kind: "push" });
  });
  test("account already on this arc: push (merge)", () => {
    expect(decideFirstSync(local, toSyncChanges(local))).toEqual({ kind: "push" });
  });
  test("different arc on the account: conflict", () => {
    const remote = makeData();
    expect(decideFirstSync(local, toSyncChanges(remote))).toEqual({ kind: "conflict", serverArcId: remote.arc.id });
  });
  test("no local arc: adopt the account's", () => {
    const remote = makeData();
    expect(decideFirstSync(null, toSyncChanges(remote))).toEqual({ kind: "adopt", arcId: remote.arc.id });
  });
  test("account profile without a usable arc: push", () => {
    const remote = toSyncChanges(makeData());
    expect(decideFirstSync(local, { ...remote, arcs: [] })).toEqual({ kind: "push" });
    expect(decideFirstSync(local, { ...remote, arcs: [{ ...remote.arcs[0]!, deletedAt: T1 }] })).toEqual({ kind: "push" });
    expect(decideFirstSync(local, { ...remote, profile: { ...remote.profile!, currentArcId: null } })).toEqual({ kind: "push" });
  });
  test("summarizes the account's arc for the dialog", () => {
    const remote = makeData();
    const withCheck = setCheckIn(remote, remote.habits[0]!.id, "2026-10-01", true, T1);
    expect(summarizeServerArc(toSyncChanges(withCheck), remote.arc.id)).toEqual({
      kind: "winter",
      startDate: "2026-10-01",
      endDate: "2026-12-31",
      habits: 2,
      checkIns: 1,
    });
  });
});

describe("sync state storage", () => {
  test("round-trips", () => {
    const s = emptySyncState();
    const d = toSyncChanges(makeData());
    s.userId = "user_1";
    s.cursor = "c-42";
    s.lastSyncedAt = T1;
    markAcked(s.acked, d);
    s.history = { arcs: d.arcs, habits: d.habits, checkIns: d.checkIns };
    s.conflict = { serverArcId: d.arcs[0]!.id, serverProfile: d.profile! };
    const back = parseSyncState(serializeSyncState(s));
    expect(back).toEqual(s);
  });

  test("garbage falls back to a clean state", () => {
    expect(parseSyncState("{nope")).toEqual(emptySyncState());
    expect(parseSyncState(JSON.stringify({ v: 1, history: { arcs: [{ id: "x" }] } })).history).toEqual(emptyHistory());
    const tampered = JSON.parse(serializeSyncState(emptySyncState()));
    tampered.acked = [["__proto__", T0], ["a:" + uid(), "not a date"]];
    expect(parseSyncState(JSON.stringify(tampered)).acked.size).toBe(0);
  });

  test("forgetting the account keeps history", () => {
    const s = emptySyncState();
    s.userId = "u";
    s.cursor = "c";
    s.acked.set("p", T0);
    const d = toSyncChanges(makeData());
    s.history.arcs = d.arcs;
    const f = forgetAccount(s);
    expect(f.cursor).toBeNull();
    expect(f.userId).toBeNull();
    expect(f.acked.size).toBe(0);
    expect(f.history.arcs).toEqual(d.arcs);
  });
});
