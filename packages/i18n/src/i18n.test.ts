import { describe, expect, test } from "bun:test";
import { computeArcStats, FORGE_RANKS, HABIT_TEMPLATES, MILESTONE_DAYS, winterArcWindow } from "@cold-forge/core";
import { buildMilestoneShareText, buildShareText, detectLocale, getMessages, LOCALES } from "./index.ts";

describe("detectLocale", () => {
  test("maps regional tags to supported locales", () => {
    expect(detectLocale(["pt-BR", "en"])).toBe("pt");
    expect(detectLocale("es-MX,es;q=0.9,en;q=0.8")).toBe("es");
    expect(detectLocale(["fr-FR", "de"])).toBe("en");
    expect(detectLocale(undefined)).toBe("en");
  });
});

describe("messages", () => {
  test.each([...LOCALES])("%s covers every rank, template and milestone", (locale) => {
    const m = getMessages(locale);
    for (const r of FORGE_RANKS) expect(m.ranks[r.id]).toBeTruthy();
    for (const h of HABIT_TEMPLATES) expect(m.habits[h.id]).toBeTruthy();
    for (const d of MILESTONE_DAYS) expect(m.milestones[d]).toBeTruthy();
  });

  test("share text is localized", () => {
    const stats = computeArcStats(
      { id: "a", title: "Winter Arc 2026", ...winterArcWindow(2026), habits: [] },
      [],
      "2026-10-10",
    );
    expect(buildShareText(stats, getMessages("es"))).toContain("Día 10/92");
    expect(buildShareText(stats, getMessages("pt"))).toContain("Dia 10/92");
    expect(buildShareText(stats, getMessages("en"))).toContain("Raw Ore");
    expect(buildMilestoneShareText(stats, 7, getMessages("pt"))).toContain("Primeira semana forjada — Dia 7");
  });
});
