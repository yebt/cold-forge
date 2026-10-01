import { describe, expect, test } from "bun:test";
import { emptyChanges } from "@cold-forge/sync";
import { collectDirty, markAcked, sameInstant } from "./dirty.ts";
import { toSyncChanges } from "./mapping.ts";
import { prepareOutgoing } from "./outgoing.ts";
import { T1, makeData } from "./testkit.ts";

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
