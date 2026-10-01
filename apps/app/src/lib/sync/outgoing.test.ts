import { describe, expect, test } from "bun:test";
import { emptyChanges } from "@cold-forge/sync";
import { collectDirty, markAcked, sameInstant } from "./dirty.ts";
import { toSyncChanges } from "./mapping.ts";
import { knownParents, prepareOutgoing } from "./outgoing.ts";
import { T0, T1, makeData } from "./testkit.ts";

const NOW = Date.parse("2026-10-05T12:00:00.000Z");

describe("outgoing pre-validation", () => {
  test("valid records pass through unchanged", () => {
    const c = toSyncChanges(makeData());
    const out = prepareOutgoing(c, NOW);
    expect(out).toMatchObject({ repaired: 0, skipped: 0 });
    expect(out.changes).toEqual(c);
  });

  test("repairs what it can: emoji, hidden characters, blank names, timestamp format", () => {
    const c = toSyncChanges(makeData());
    c.habits[0]!.emoji = "not an emoji";
    c.habits[1]!.name = "​";
    c.arcs[0]!.why = "why‮";
    c.profile!.displayName = "Ya‍hir";
    c.profile!.updatedAt = "2026-10-01T08:00:00Z";
    const out = prepareOutgoing(c, NOW);
    expect(out.skipped).toBe(0);
    expect(out.repaired).toBe(4);
    expect(out.changes.habits[0]!.emoji).toBe("🔥");
    expect(out.changes.habits[1]!.name).toBe("Habit");
    expect(out.changes.arcs[0]!.why).toBe("why");
    expect(out.changes.profile).toMatchObject({ displayName: "Yahir", updatedAt: "2026-10-01T08:00:00.000Z" });
  });

  test("an unrepairable record is held back without blocking the rest", () => {
    const d = makeData();
    const c = { ...emptyChanges(), habits: toSyncChanges(d).habits };
    c.habits[0] = { ...c.habits[0]!, updatedAt: "2030-01-01T00:00:00.000Z" }; // device clock far ahead
    c.checkIns = [{ habitId: d.habits[0]!.id, date: "2026-10-01", done: true, updatedAt: T1 }];
    const out = prepareOutgoing(c, NOW);
    expect(out.skipped).toBe(1);
    expect(out.changes.habits).toHaveLength(1);
    expect(out.changes.checkIns).toHaveLength(1);
  });
});

describe("write bounds (mirror of the Firestore rules)", () => {
  test("check-ins outside [now - 400 d, now + 2 d] stay on the device (held back), the rest go", () => {
    const d = makeData();
    const c = toSyncChanges(d);
    const h = d.habits[0]!.id;
    c.checkIns = [
      { habitId: h, date: "2025-08-30", done: true, updatedAt: T1 }, // 401 days before NOW: imported history
      { habitId: h, date: "2025-09-02", done: true, updatedAt: T1 }, // 398 days: fine
      { habitId: h, date: "2026-10-01", done: true, updatedAt: T1 },
      { habitId: h, date: "2026-10-09", done: true, updatedAt: T1 }, // 4 days ahead
    ];
    const out = prepareOutgoing(c, NOW, knownParents(c));
    expect(out.changes.checkIns.map((x) => x.date)).toEqual(["2025-09-02", "2026-10-01"]);
    expect(out.skipped).toBe(2);
  });

  test("arcs before 2024 or longer than 366 days are held back with their children and the profile", () => {
    const d = makeData();
    const c = toSyncChanges(d);
    c.arcs[0] = { ...c.arcs[0]!, startDate: "2023-10-01", endDate: "2023-12-31" };
    const out = prepareOutgoing(c, NOW, knownParents(c));
    expect(out.changes.arcs).toEqual([]);
    expect(out.changes.habits).toEqual([]);
    expect(out.changes.profile).toBeNull(); // it names the held-back arc as current
    const long = toSyncChanges(d);
    long.arcs[0] = { ...long.arcs[0]!, startDate: "2026-01-01", endDate: "2027-01-01" }; // 366 days: ok
    expect(prepareOutgoing(long, NOW).changes.arcs).toHaveLength(1);
    long.arcs[0] = { ...long.arcs[0]!, endDate: "2027-01-02" }; // 367
    expect(prepareOutgoing(long, NOW).changes.arcs).toHaveLength(0);
  });

  test("createdAt after updatedAt (clock moved back) is repaired; timestamps before 2024 are held", () => {
    const c = { ...emptyChanges(), arcs: toSyncChanges(makeData()).arcs };
    c.arcs[0] = { ...c.arcs[0]!, createdAt: T1, updatedAt: T0 };
    const out = prepareOutgoing(c, NOW);
    expect(out.repaired).toBe(1);
    expect(out.changes.arcs[0]).toMatchObject({ createdAt: T0, updatedAt: T0 });
    c.arcs[0] = { ...c.arcs[0]!, createdAt: "2023-12-31T00:00:00.000Z" };
    expect(prepareOutgoing(c, NOW).changes.arcs).toEqual([]);
  });

  test("check-ins of a tombstoned habit are obsolete (the rules refuse them for good)", () => {
    const d = makeData();
    const c = toSyncChanges(d);
    c.habits[0] = { ...c.habits[0]!, deletedAt: T1, updatedAt: T1 };
    c.checkIns = [
      { habitId: c.habits[0]!.id, date: "2026-10-01", done: true, updatedAt: T0 },
      { habitId: c.habits[1]!.id, date: "2026-10-01", done: true, updatedAt: T0 },
    ];
    const out = prepareOutgoing(c, NOW, knownParents(c));
    expect(out.changes.habits).toHaveLength(2); // the tombstone itself is sent
    expect(out.changes.checkIns.map((x) => x.habitId)).toEqual([c.habits[1]!.id]);
    expect(out.obsolete.map((x) => x.habitId)).toEqual([c.habits[0]!.id]);
  });

  test("a live habit under a tombstoned arc is held back", () => {
    const c = toSyncChanges(makeData());
    const known = knownParents({ ...c, arcs: [{ ...c.arcs[0]!, deletedAt: T1 }] });
    const out = prepareOutgoing({ ...emptyChanges(), habits: c.habits }, NOW, known);
    expect(out.changes.habits).toEqual([]);
    expect(out.skipped).toBe(2);
  });
});

describe("timestamps compare by instant", () => {
  test("…:00Z equals …:00.000Z", () => {
    expect(sameInstant("2026-10-01T08:00:00Z", "2026-10-01T08:00:00.000Z")).toBe(true);
    expect(sameInstant("2026-10-01T08:00:00.5Z", "2026-10-01T08:00:00.500Z")).toBe(true);
    expect(sameInstant("2026-10-01T08:00:00.001Z", "2026-10-01T08:00:00.000Z")).toBe(false);
    expect(sameInstant(undefined, "2026-10-01T08:00:00.000Z")).toBe(false);
  });

  test("a server echo with 3 ms digits doesn't make a record dirty", () => {
    const c = toSyncChanges(makeData());
    c.checkIns = [{ habitId: c.habits[0]!.id, date: "2026-10-01", done: true, updatedAt: "2026-10-01T08:00:00Z" }];
    const acked = new Map<string, string>();
    markAcked(acked, { ...c, checkIns: [{ ...c.checkIns[0]!, updatedAt: "2026-10-01T08:00:00.000Z" }] });
    expect(collectDirty(c, acked).checkIns).toHaveLength(0);
  });
});
