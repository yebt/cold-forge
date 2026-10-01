import { describe, expect, test } from "bun:test";
import {
  activeHabits,
  addHabit,
  checkInKey,
  createAppData,
  deleteHabit,
  isDone,
  markMilestonesCelebrated,
  moveHabit,
  parseAppData,
  setCheckIn,
  updateHabit,
  updateSettings,
  type AppData,
} from "./model.ts";

const T0 = "2026-10-01T08:00:00.000Z";
const T1 = "2026-10-01T09:00:00.000Z";

function fixture(): AppData {
  return createAppData(
    {
      kind: "winter",
      window: { startDate: "2026-10-01", endDate: "2026-12-31" },
      habits: [
        { templateId: "gym", name: "Gym", emoji: "🏋️" },
        { templateId: "read", name: "Read 20 min", emoji: "📚" },
        { name: "  Guitar ", emoji: "🎸" },
      ],
      why: "  stronger  ",
      displayName: " Yahir ",
      locale: "es",
    },
    T0,
  );
}

describe("createAppData", () => {
  test("builds records with timestamps and trimmed text", () => {
    const d = fixture();
    expect(d.arc.why).toBe("stronger");
    expect(d.settings.displayName).toBe("Yahir");
    expect(d.settings.locale).toBe("es");
    expect(d.settings.reminderTime).toBe("21:00");
    expect(d.habits.map((h) => h.order)).toEqual([0, 1, 2]);
    expect(d.habits[2]!.name).toBe("Guitar");
    expect(d.habits[2]!.templateId).toBeUndefined();
    expect(d.habits.every((h) => h.updatedAt === T0)).toBe(true);
    expect(new Set(d.habits.map((h) => h.id)).size).toBe(3);
  });

  test("keeps previous settings when starting a new arc", () => {
    const prev = updateSettings(fixture(), { reminderEnabled: true, sound: false }, T0);
    const next = createAppData(
      { kind: "custom", window: { startDate: "2027-01-01", endDate: "2027-04-02" }, habits: [], why: "", displayName: "", locale: "en", settings: prev.settings },
      T1,
    );
    expect(next.settings.reminderEnabled).toBe(true);
    expect(next.settings.sound).toBe(false);
    expect(next.settings.locale).toBe("en");
  });
});

describe("check-ins", () => {
  test("set and unset with updatedAt", () => {
    const d = fixture();
    const id = d.habits[0]!.id;
    const a = setCheckIn(d, id, "2026-10-01", true, T1);
    expect(isDone(a, id, "2026-10-01")).toBe(true);
    expect(a.checkIns[checkInKey(id, "2026-10-01")]).toEqual({ habitId: id, date: "2026-10-01", done: true, updatedAt: T1 });
    const b = setCheckIn(a, id, "2026-10-01", false, T1);
    expect(isDone(b, id, "2026-10-01")).toBe(false);
    // Unchecking keeps a record (done=false) for last-write-wins sync.
    expect(b.checkIns[checkInKey(id, "2026-10-01")]?.done).toBe(false);
    expect(isDone(d, id, "2026-10-01")).toBe(false); // immutable
  });
});

describe("habits", () => {
  test("add appends at the end", () => {
    const d = addHabit(fixture(), { name: "Run", emoji: "🏃" }, T1);
    expect(activeHabits(d).at(-1)!.name).toBe("Run");
    expect(activeHabits(d).at(-1)!.order).toBe(3);
  });

  test("delete is a tombstone", () => {
    const d = fixture();
    const id = d.habits[1]!.id;
    const next = deleteHabit(d, id, T1);
    expect(activeHabits(next).map((h) => h.id)).not.toContain(id);
    expect(next.habits.find((h) => h.id === id)?.deletedAt).toBe(T1);
  });

  test("rename drops the template so the custom name sticks", () => {
    const d = fixture();
    const id = d.habits[0]!.id;
    const next = updateHabit(d, id, { name: "Lift heavy", emoji: "💪" }, T1);
    const h = next.habits.find((x) => x.id === id)!;
    expect(h.name).toBe("Lift heavy");
    expect(h.emoji).toBe("💪");
    expect(h.templateId).toBeUndefined();
    expect(h.updatedAt).toBe(T1);
  });

  test("emoji-only edit keeps the template", () => {
    const d = fixture();
    const id = d.habits[0]!.id;
    expect(updateHabit(d, id, { emoji: "🔥" }, T1).habits[0]!.templateId).toBe("gym");
  });

  test("move swaps neighbours and ignores out-of-range moves", () => {
    const d = fixture();
    const [a, b, c] = d.habits.map((h) => h.id);
    const down = moveHabit(d, a!, 1, T1);
    expect(activeHabits(down).map((h) => h.id)).toEqual([b!, a!, c!]);
    expect(moveHabit(d, a!, -1, T1)).toBe(d);
    expect(moveHabit(d, c!, 1, T1)).toBe(d);
  });
});

describe("milestones bookkeeping", () => {
  test("marks once, sorted, returns same object when nothing changes", () => {
    const d = markMilestonesCelebrated(fixture(), [30, 7]);
    expect(d.celebratedMilestones).toEqual([7, 30]);
    expect(markMilestonesCelebrated(d, [7])).toBe(d);
  });
});

describe("parseAppData", () => {
  test("round-trips through JSON", () => {
    const d = setCheckIn(fixture(), fixture().habits[0]!.id, "2026-10-02", true, T1);
    expect(parseAppData(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });

  test("rejects garbage and wrong versions", () => {
    expect(parseAppData(null)).toBeNull();
    expect(parseAppData({ version: 99 })).toBeNull();
    const bad = JSON.parse(JSON.stringify(fixture()));
    bad.arc.startDate = "2026-13-40";
    expect(parseAppData(bad)).toBeNull();
    const badLocale = JSON.parse(JSON.stringify(fixture()));
    badLocale.settings.locale = "fr";
    expect(parseAppData(badLocale)).toBeNull();
  });

  test("repairs an invalid reminder time", () => {
    const raw = JSON.parse(JSON.stringify(fixture()));
    raw.settings.reminderTime = "25:99";
    expect(parseAppData(raw)?.settings.reminderTime).toBe("21:00");
  });
});
