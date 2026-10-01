import { describe, expect, test } from "bun:test";
import { emptyChanges, type SyncChanges, type SyncHabit } from "@cold-forge/sync";
import { checkInKey, deleteHabit, setCheckIn, updateSettings, type AppData } from "../model.ts";
import { applyRemote, emptyHistory, localRecords, toSyncChanges } from "./mapping.ts";
import { T0, T1, T2, T3, TODAY, makeData, uid } from "./testkit.ts";

const opts = { today: TODAY, now: T3 };

function withChecks(): AppData {
  let d = makeData();
  d = setCheckIn(d, d.habits[0]!.id, "2026-10-01", true, T1);
  d = setCheckIn(d, d.habits[1]!.id, "2026-10-02", false, T1);
  return d;
}

describe("AppData <-> SyncChanges", () => {
  test("maps every record and the profile, but no device-only prefs", () => {
    const d = updateSettings(withChecks(), { sound: false, reminderEnabled: true }, T2);
    const c = toSyncChanges(d);
    expect(c.arcs).toEqual([
      { id: d.arc.id, kind: "winter", startDate: "2026-10-01", endDate: "2026-12-31", why: "stronger", createdAt: T0, updatedAt: T0 },
    ]);
    expect(c.habits.map((h) => h.arcId)).toEqual([d.arc.id, d.arc.id]);
    expect(c.checkIns).toHaveLength(2);
    // Sound/reminder changes don't bump the synced profile.
    expect(c.profile).toEqual({ displayName: "Yahir", locale: "es", currentArcId: d.arc.id, updatedAt: T0 });
    expect(JSON.stringify(c)).not.toContain("sound");
    expect(JSON.stringify(c)).not.toContain("reminder");
  });

  test("display name and locale changes bump the profile", () => {
    const d = updateSettings(makeData(), { displayName: "Neo" }, T2);
    expect(toSyncChanges(d).profile?.updatedAt).toBe(T2);
    expect(toSyncChanges(updateSettings(makeData(), { displayName: "Yahir" }, T2)).profile?.updatedAt).toBe(T0);
  });

  test("round trip: applying our own records to an empty device rebuilds the same data", () => {
    const d = withChecks();
    const r = applyRemote(null, emptyHistory(), toSyncChanges(d), opts);
    expect(r.data?.arc).toEqual(d.arc);
    expect(r.data?.habits).toEqual(d.habits);
    expect(r.data?.checkIns).toEqual(d.checkIns);
    expect(r.data?.settings.displayName).toBe("Yahir");
    expect(r.data?.settings.locale).toBe("es");
    // Milestones already reached aren't celebrated again on a new device.
    expect(r.data?.celebratedMilestones).toEqual([]);
    expect(r.history).toEqual(emptyHistory());
  });

  test("replaying the same records is a no-op", () => {
    const d = withChecks();
    const r = applyRemote(d, emptyHistory(), toSyncChanges(d), opts);
    expect(r.changed).toBe(false);
    expect(r.data).toBe(d);
  });
});

describe("applyRemote (last-write-wins)", () => {
  test("newer server records win, older ones lose, ties keep local", () => {
    const d = withChecks();
    const [h0, h1] = d.habits;
    const incoming: SyncChanges = {
      ...emptyChanges(),
      habits: [
        { ...toSyncChanges(d).habits[0]!, name: "Newer", updatedAt: T2 },
        { ...toSyncChanges(d).habits[1]!, name: "Older", updatedAt: "2026-09-01T00:00:00.000Z" },
      ],
    };
    const r = applyRemote(d, emptyHistory(), incoming, opts);
    expect(r.changed).toBe(true);
    expect(r.data!.habits.find((h) => h.id === h0!.id)!.name).toBe("Newer");
    expect(r.data!.habits.find((h) => h.id === h1!.id)!.name).toBe("Habit 2");
  });

  test("tombstones and un-checks propagate", () => {
    const d = withChecks();
    const h0 = d.habits[0]!;
    const remote = toSyncChanges(deleteHabit(setCheckIn(d, h0.id, "2026-10-01", false, T2), d.habits[1]!.id, T2));
    const r = applyRemote(d, emptyHistory(), remote, opts);
    expect(r.data!.checkIns[checkInKey(h0.id, "2026-10-01")]).toEqual({ habitId: h0.id, date: "2026-10-01", done: false, updatedAt: T2 });
    expect(r.data!.habits.find((h) => h.id === d.habits[1]!.id)!.deletedAt).toBe(T2);
  });

  test("a local edit newer than the server's survives", () => {
    const d = setCheckIn(withChecks(), makeData().habits[0]!.id, "2026-10-01", true, T1);
    const local = setCheckIn(d, d.habits[0]!.id, "2026-10-01", false, T3);
    const r = applyRemote(local, emptyHistory(), { ...emptyChanges(), checkIns: toSyncChanges(d).checkIns }, opts);
    expect(r.data!.checkIns[checkInKey(d.habits[0]!.id, "2026-10-01")]!.done).toBe(false);
  });

  test("records of other arcs go to history; a newer profile switches the current arc", () => {
    const d = withChecks();
    const other = makeData({ name: "Other" });
    const otherChanges = toSyncChanges(other);
    // Another device started a new arc later.
    const incoming: SyncChanges = { ...otherChanges, profile: { ...otherChanges.profile!, updatedAt: T2 } };

    const r = applyRemote(d, emptyHistory(), incoming, opts);
    expect(r.data!.arc.id).toBe(other.arc.id);
    expect(r.data!.habits.map((h) => h.id)).toEqual(other.habits.map((h) => h.id));
    expect(r.data!.settings.displayName).toBe("Other");
    // Device prefs survive the switch.
    expect(r.data!.settings.sound).toBe(d.settings.sound);
    // Nothing is lost: the previous arc is in history.
    expect(r.history.arcs.map((a) => a.id)).toEqual([d.arc.id]);
    expect(r.history.habits.every((h) => h.arcId === d.arc.id)).toBe(true);
    expect(r.history.checkIns).toHaveLength(2);
    // And it can come back.
    const back = applyRemote(r.data, r.history, { ...emptyChanges(), profile: { ...incoming.profile!, currentArcId: d.arc.id, updatedAt: T3 } }, opts);
    expect(back.data!.arc.id).toBe(d.arc.id);
    expect(back.data!.checkIns).toEqual(d.checkIns);
  });

  test("an older profile does not switch the arc", () => {
    const d = updateSettings(withChecks(), { displayName: "Local" }, T2);
    const other = toSyncChanges(makeData());
    const r = applyRemote(d, emptyHistory(), { ...other, profile: { ...other.profile!, updatedAt: T1 } }, opts);
    expect(r.data!.arc.id).toBe(d.arc.id);
    expect(r.data!.settings.displayName).toBe("Local");
    expect(r.history.arcs).toHaveLength(1);
  });

  test("a profile pointing at an unknown arc keeps the local one and schedules a fix-up push", () => {
    const d = withChecks();
    const r = applyRemote(d, emptyHistory(), { ...emptyChanges(), profile: { displayName: "X", locale: "en", currentArcId: uid(), updatedAt: T2 } }, opts);
    expect(r.data!.arc.id).toBe(d.arc.id);
    expect(r.data!.settings.profileUpdatedAt).toBe(T3);
  });

  test("with no local data and nothing current on the server, records wait in history", () => {
    const h: SyncHabit = { id: uid(), arcId: uid(), name: "x", emoji: "🔥", order: 0, createdAt: T0, updatedAt: T0 };
    const r = applyRemote(null, emptyHistory(), { ...emptyChanges(), habits: [h] }, opts);
    expect(r.data).toBeNull();
    expect(r.history.habits).toEqual([h]);
  });

  test("localRecords includes history", () => {
    const d = withChecks();
    const other = toSyncChanges(makeData());
    const all = localRecords(d, { arcs: other.arcs, habits: other.habits, checkIns: other.checkIns });
    expect(all.arcs).toHaveLength(2);
    expect(all.habits).toHaveLength(4);
  });
});

test("keepEmpty: an onboarding device does not get an arc pushed onto it", () => {
  const remote = toSyncChanges(makeData());
  const r = applyRemote(null, emptyHistory(), remote, { ...opts, keepEmpty: true });
  expect(r.data).toBeNull();
  expect(r.history.arcs).toHaveLength(1);
});
