import { describe, expect, test } from "bun:test";
import {
  arcLength,
  buildShareText,
  computeArcStats,
  currentStreak,
  isISODate,
  longestStreak,
  rankFor,
  winterArcWindow,
  type Arc,
  type CheckIn,
} from "./index.ts";

const arc: Arc = {
  id: "arc-1",
  title: "Winter Arc 2026",
  ...winterArcWindow(2026),
  habits: [
    { id: "gym", name: "Gym", emoji: "🏋️", createdAt: "2026-10-01T00:00:00Z" },
    { id: "read", name: "Leer", emoji: "📚", createdAt: "2026-10-01T00:00:00Z" },
  ],
};

describe("dates", () => {
  test("validates real calendar dates", () => {
    expect(isISODate("2026-10-01")).toBe(true);
    expect(isISODate("2026-02-30")).toBe(false);
    expect(isISODate("hoy")).toBe(false);
  });

  test("winter arc spans Oct 1 to Dec 31", () => {
    expect(arcLength(arc)).toBe(92);
  });
});

describe("streaks", () => {
  test("current streak survives while today is pending", () => {
    const done = new Set(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(currentStreak(done, "2026-10-03")).toBe(3);
    expect(currentStreak(done, "2026-10-04")).toBe(3);
    expect(currentStreak(done, "2026-10-05")).toBe(0);
  });

  test("longest streak finds the best run", () => {
    const done = new Set(["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07"]);
    expect(longestStreak(done)).toBe(3);
  });
});

describe("computeArcStats", () => {
  const checkIns: CheckIn[] = [
    { habitId: "gym", date: "2026-10-01" },
    { habitId: "read", date: "2026-10-01" },
    { habitId: "gym", date: "2026-10-02" },
    { habitId: "read", date: "2026-10-02" },
    { habitId: "gym", date: "2026-10-03" },
    { habitId: "gym", date: "2025-12-31" }, // outside the arc, ignored
  ];

  test("tracks day, perfect days and completion", () => {
    const stats = computeArcStats(arc, checkIns, "2026-10-03");
    expect(stats.status).toBe("active");
    expect(stats.day).toBe(3);
    expect(stats.daysRemaining).toBe(89);
    expect(stats.perfectDays).toBe(2);
    expect(stats.perfectStreak).toBe(2);
    expect(stats.completionRate).toBeCloseTo(5 / 6);
    expect(stats.habits.find((h) => h.habit.id === "gym")?.currentStreak).toBe(3);
  });

  test("a pending today doesn't drag completion down", () => {
    const stats = computeArcStats(arc, checkIns.slice(0, 4), "2026-10-03");
    expect(stats.completionRate).toBe(1);
  });

  test("handles arcs that haven't started or are over", () => {
    expect(computeArcStats(arc, [], "2026-09-15").status).toBe("upcoming");
    const done = computeArcStats(arc, [], "2027-01-10");
    expect(done.status).toBe("finished");
    expect(done.day).toBe(92);
  });
});

describe("ranks and sharing", () => {
  test("ranks scale with perfect days", () => {
    expect(rankFor(0).rank.name).toBe("Mineral crudo");
    expect(rankFor(21).rank.name).toBe("Acero");
    expect(rankFor(200).nextRank).toBeNull();
  });

  test("share text includes the key numbers", () => {
    const text = buildShareText(computeArcStats(arc, [], "2026-10-10"));
    expect(text).toContain("Día 10/92");
    expect(text).toContain("#WinterArc");
  });
});
