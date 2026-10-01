import { describe, expect, test } from "bun:test";
import { getMessages } from "@cold-forge/i18n";
import { arcOptions, arcTitle, dayProgress, derive, deriveCheckIns, heatmap, isEditableDate, toCoreArc } from "./derive.ts";
import { createAppData, deleteHabit, setCheckIn, type AppData } from "./model.ts";

const NOW = "2026-10-01T00:00:00.000Z";

function fixture(): AppData {
  let d = createAppData(
    {
      kind: "winter",
      window: { startDate: "2026-10-01", endDate: "2026-12-31" },
      habits: [
        { templateId: "coldShower", name: "Cold shower", emoji: "🧊" },
        { name: "Guitar", emoji: "🎸" },
      ],
      why: "",
      displayName: "",
      locale: "en",
    },
    NOW,
  );
  const [a, b] = d.habits.map((h) => h.id);
  for (const date of ["2026-10-01", "2026-10-02", "2026-10-03"]) {
    d = setCheckIn(d, a!, date, true, NOW);
    d = setCheckIn(d, b!, date, true, NOW);
  }
  d = setCheckIn(d, a!, "2026-10-04", true, NOW);
  d = setCheckIn(d, b!, "2026-10-04", false, NOW);
  return d;
}

describe("toCoreArc", () => {
  test("localizes template names, keeps custom ones", () => {
    const es = toCoreArc(fixture(), getMessages("es"));
    expect(es.habits.map((h) => h.name)).toEqual(["Ducha fría", "Guitar"]);
    expect(es.title).toBe("Winter Arc 2026");
  });

  test("custom arc title", () => {
    expect(arcTitle({ kind: "custom", startDate: "2026-11-05" }, getMessages("en"))).toBe("My 92 days");
  });
});

describe("deriveCheckIns", () => {
  test("only done records of live habits, sorted", () => {
    const d = fixture();
    const cis = deriveCheckIns(d);
    expect(cis).toHaveLength(7);
    expect(cis[0]!.date).toBe("2026-10-01");
    const gone = deleteHabit(d, d.habits[1]!.id, NOW);
    expect(deriveCheckIns(gone)).toHaveLength(4);
  });
});

describe("derive", () => {
  test("stats from stored data", () => {
    const { stats } = derive(fixture(), getMessages("en"), "2026-10-04");
    expect(stats.day).toBe(4);
    expect(stats.perfectDays).toBe(3);
    expect(stats.perfectStreak).toBe(3);
    expect(stats.habits[0]!.currentStreak).toBe(4);
  });
});

describe("heatmap", () => {
  test("92 cells with states", () => {
    const cells = heatmap(fixture(), "2026-10-05");
    expect(cells).toHaveLength(92);
    expect(cells[0]!.state).toBe("perfect");
    expect(cells[3]!.state).toBe("partial");
    expect(cells[3]!.level).toBe(0.5);
    expect(cells[4]!.state).toBe("empty");
    expect(cells[4]!.isToday).toBe(true);
    expect(cells[5]!.state).toBe("future");
    expect(cells[5]!.editable).toBe(false);
    expect(heatmap(fixture(), "2026-10-06")[4]!.state).toBe("missed");
  });

  test("dayProgress", () => {
    expect(dayProgress(fixture(), "2026-10-04")).toEqual({ done: 1, total: 2 });
  });
});

describe("arcOptions", () => {
  test("during the Winter Arc you join at day N", () => {
    const { winter, custom } = arcOptions("2026-10-15");
    expect(winter.status).toBe("active");
    expect(winter.day).toBe(15);
    expect(custom.window).toEqual({ startDate: "2026-10-15", endDate: "2027-01-14" });
  });

  test("before October the official arc is upcoming", () => {
    const { winter } = arcOptions("2027-03-10");
    expect(winter.window.startDate).toBe("2027-10-01");
    expect(winter.status).toBe("upcoming");
    expect(winter.startsIn).toBe(205);
  });

  test("Dec 31 is still day 92", () => {
    expect(arcOptions("2026-12-31").winter.day).toBe(92);
  });
});

test("isEditableDate", () => {
  const arc = { startDate: "2026-10-01", endDate: "2026-12-31" };
  expect(isEditableDate(arc, "2026-10-03", "2026-10-05")).toBe(true);
  expect(isEditableDate(arc, "2026-10-06", "2026-10-05")).toBe(false);
  expect(isEditableDate(arc, "2026-09-30", "2026-10-05")).toBe(false);
});
