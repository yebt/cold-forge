import { describe, expect, test } from "bun:test";
import { MESSAGES } from "@cold-forge/i18n";
import { headline, stripLeadingEmoji } from "./cards/common.ts";
import { computeHeatmap, heatmapLevel, HEATMAP_LEVELS, longestPerfectRun } from "./heatmap.ts";
import { columns, gridLayout } from "./layout.ts";
import { createRng, hashString } from "./rng.ts";
import { ELLIPSIS, fitFontSize, graphemes, splitDayLabel, splitLabel, truncateToWidth, wrapText } from "./text.ts";

/** Fake monospace measure: every grapheme is `w` px wide. */
const mono = (w = 10) => (s: string) => graphemes(s).length * w;

describe("rng", () => {
  test("same seed → same sequence", () => {
    const a = createRng("winter|23");
    const b = createRng("winter|23");
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  test("different seeds diverge", () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  test("values stay in range", () => {
    const r = createRng("range");
    for (let i = 0; i < 1000; i++) {
      const f = r.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = r.int(3, 7);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(7);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  test("hashString is stable 32-bit", () => {
    expect(hashString("cold forge")).toBe(hashString("cold forge"));
    expect(hashString("a")).not.toBe(hashString("b"));
    expect(hashString("x")).toBeLessThan(2 ** 32);
  });
});

describe("text fitting", () => {
  test("short text is untouched", () => {
    expect(truncateToWidth("Gym", 100, mono())).toBe("Gym");
  });

  test("long text gets the longest prefix that fits plus an ellipsis", () => {
    const out = truncateToWidth("Drink 2L of water", 100, mono());
    expect(out).toBe("Drink 2L" + ELLIPSIS);
    expect(mono()(out)).toBeLessThanOrEqual(100);
  });

  test("never splits an emoji", () => {
    const out = truncateToWidth("🏋️‍♀️🏋️‍♀️🏋️‍♀️🏋️‍♀️", 30, mono());
    expect(out).toBe("🏋️‍♀️🏋️‍♀️" + ELLIPSIS);
  });

  test("returns empty string when even the ellipsis can't fit", () => {
    expect(truncateToWidth("hello", 5, mono())).toBe("");
  });

  test("fitFontSize shrinks proportionally and respects the minimum", () => {
    const measureAt = (size: number) => (s: string) => s.length * size * 0.5;
    expect(fitFontSize("abcd", 1000, 80, 20, measureAt)).toBe(80);
    const size = fitFontSize("abcdefghij", 300, 80, 20, measureAt);
    expect(size).toBe(60);
    expect(fitFontSize("a".repeat(500), 300, 80, 20, measureAt)).toBe(20);
  });

  test("wrapText wraps greedily and truncates the last line", () => {
    expect(wrapText("Primera semana forjada", 150, 2, mono())).toEqual(["Primera semana", "forjada"]);
    const lines = wrapText("one two three four five six seven", 90, 2, mono());
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("one two");
    expect(lines[1]!.endsWith(ELLIPSIS)).toBe(true);
    expect(wrapText("one two three", 1000, 1, mono())).toEqual(["one two three"]);
    expect(wrapText("one two three", 60, 1, mono())).toEqual(["one t" + ELLIPSIS]);
    expect(wrapText("   ", 100, 2, mono())).toEqual([]);
  });

  test("splitDayLabel works for every locale", () => {
    expect(splitDayLabel(MESSAGES.en.stats.day(23, 92), 23, 92)).toEqual({ prefix: "Day", number: "23", suffix: "/92" });
    expect(splitDayLabel(MESSAGES.es.stats.day(7, 92), 7, 92)).toEqual({ prefix: "Día", number: "7", suffix: "/92" });
    expect(splitDayLabel(MESSAGES.pt.stats.day(92, 92), 92, 92)).toEqual({ prefix: "Dia", number: "92", suffix: "/92" });
    expect(splitDayLabel("Day twenty", 20, 92)).toBeNull();
    expect(splitLabel(MESSAGES.es.days(92), "92", "92")).toEqual({ prefix: "", number: "92", suffix: " días" });
  });
});

describe("heatmap", () => {
  test("levels: 0 for nothing, top level only for perfect days", () => {
    expect(heatmapLevel(0)).toBe(0);
    expect(heatmapLevel(Number.NaN)).toBe(0);
    expect(heatmapLevel(1)).toBe(HEATMAP_LEVELS - 1);
    expect(heatmapLevel(0.99)).toBe(HEATMAP_LEVELS - 2);
    expect(heatmapLevel(0.01)).toBe(1);
    expect(heatmapLevel(0.5)).toBe(2);
    for (let f = 0; f <= 1; f += 0.05) {
      const l = heatmapLevel(f);
      expect(l).toBeGreaterThanOrEqual(0);
      expect(l).toBeLessThan(HEATMAP_LEVELS);
    }
  });

  const arc = { startDate: "2026-10-01", endDate: "2026-12-31" };
  const checkIns = [
    { habitId: "a", date: "2026-10-01" },
    { habitId: "b", date: "2026-10-01" },
    { habitId: "a", date: "2026-10-02" },
    { habitId: "a", date: "2026-10-02" }, // duplicate
    { habitId: "gone", date: "2026-10-03" }, // deleted habit
    { habitId: "a", date: "2026-10-04" },
    { habitId: "b", date: "2026-10-04" },
    { habitId: "a", date: "2026-10-05" },
    { habitId: "b", date: "2026-10-05" },
    { habitId: "a", date: "2026-10-09" }, // future relative to today
  ];

  test("one cell per arc day with fraction, level and state", () => {
    const cells = computeHeatmap(arc, checkIns, ["a", "b"], "2026-10-05");
    expect(cells).toHaveLength(92);
    expect(cells[0]).toMatchObject({ date: "2026-10-01", fraction: 1, level: HEATMAP_LEVELS - 1, state: "past" });
    expect(cells[1]).toMatchObject({ fraction: 0.5, state: "past" });
    expect(cells[2]).toMatchObject({ fraction: 0, level: 0 });
    expect(cells[4]).toMatchObject({ date: "2026-10-05", fraction: 1, state: "today" });
    expect(cells[8]).toMatchObject({ fraction: 0, state: "future" });
    expect(longestPerfectRun(cells)).toBe(2);
  });

  test("zero habits → all zero", () => {
    const cells = computeHeatmap(arc, checkIns, [], "2026-10-05");
    expect(cells.every((c) => c.level === 0)).toBe(true);
  });
});

describe("layout", () => {
  test("grid fits the width and lays out row-major", () => {
    const g = gridLayout(92, 880, 4, 6);
    expect(g.cols).toBe(23);
    expect(g.rects).toHaveLength(92);
    expect(g.width).toBeLessThanOrEqual(880);
    expect(g.rects[1]!.y).toBe(0);
    expect(g.rects[23]!.y).toBe(g.cell + 6);
    const last = g.rects[91]!;
    expect(last.x + last.w).toBeLessThanOrEqual(880);
  });

  test("weighted columns fill the width", () => {
    const cols = columns(80, 920, [1, 1, 1.3], 24);
    const last = cols[2]!;
    expect(last.x + last.w).toBeCloseTo(1000);
    expect(last.w).toBeCloseTo(cols[0]!.w * 1.3);
  });
});

describe("copy", () => {
  test("headline uses localized upcoming / finished lines without the leading emoji", () => {
    const base = { title: "Winter Arc", totalDays: 92 };
    const mk = (status: "upcoming" | "active" | "finished") =>
      headline({ stats: { ...base, status }, messages: MESSAGES.pt } as never);
    expect(mk("active")).toBe("Winter Arc");
    expect(mk("upcoming")).toBe("Winter Arc — começa em breve");
    expect(mk("finished")).toBe("Winter Arc — COMPLETO (92 dias)");
    expect(stripLeadingEmoji("❄️ hi")).toBe("hi");
  });
});
