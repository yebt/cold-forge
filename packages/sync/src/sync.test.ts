import { describe, expect, test } from "bun:test";
import {
  emptyChanges,
  incomingWins,
  mergeChanges,
  normalizeEmail,
  parseMagicLinkRequest,
  parseSyncRequest,
  parseVerifyRequest,
  type SyncChanges,
} from "./index.ts";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const ARC = "11111111-1111-4111-8111-111111111111";
const HABIT = "22222222-2222-4222-8222-222222222222";

const valid = () => ({
  protocol: 1,
  cursor: null,
  changes: {
    arcs: [
      {
        id: ARC,
        kind: "winter",
        startDate: "2026-10-01",
        endDate: "2026-12-31",
        why: "Be stronger",
        createdAt: "2026-10-01T08:00:00.000Z",
        updatedAt: "2026-10-01T08:00:00.000Z",
      },
    ],
    habits: [
      {
        id: HABIT,
        arcId: ARC,
        templateId: "coldShower",
        name: "",
        emoji: "🧊",
        order: 0,
        createdAt: "2026-10-01T08:00:00.000Z",
        updatedAt: "2026-10-01T08:00:00.000Z",
      },
    ],
    checkIns: [{ habitId: HABIT, date: "2026-10-01", done: true, updatedAt: "2026-10-01T09:00:00.000Z" }],
    profile: { displayName: "Yahir", locale: "es", currentArcId: ARC, updatedAt: "2026-10-01T08:00:00.000Z" },
  },
});

describe("parseSyncRequest", () => {
  test("accepts a valid body and drops unknown fields", () => {
    const body = valid() as Record<string, unknown>;
    (body.changes as { arcs: Record<string, unknown>[] }).arcs[0]!.evil = "x";
    const res = parseSyncRequest(body, NOW);
    expect(res.ok).toBe(true);
    if (res.ok) expect("evil" in res.value.changes.arcs[0]!).toBe(false);
  });

  test.each([
    ["future timestamps", (b: ReturnType<typeof valid>) => (b.changes.checkIns[0]!.updatedAt = "2099-01-01T00:00:00Z")],
    ["bad ids", (b: ReturnType<typeof valid>) => (b.changes.habits[0]!.id = "../../etc")],
    ["sql-ish ids", (b: ReturnType<typeof valid>) => (b.changes.habits[0]!.arcId = "1' OR '1'='1")],
    ["unknown templates", (b: ReturnType<typeof valid>) => (b.changes.habits[0]!.templateId = "hack")],
    ["long names", (b: ReturnType<typeof valid>) => (b.changes.habits[0]!.name = "x".repeat(61))],
    ["control chars", (b: ReturnType<typeof valid>) => (b.changes.profile.displayName = "a‮b")],
    ["bad dates", (b: ReturnType<typeof valid>) => (b.changes.checkIns[0]!.date = "2026-02-30")],
    ["wrong protocol", (b: ReturnType<typeof valid>) => ((b as { protocol: number }).protocol = 2)],
    ["non-boolean done", (b: ReturnType<typeof valid>) => ((b.changes.checkIns[0] as { done: unknown }).done = "yes")],
    ["prototype pollution", (b: ReturnType<typeof valid>) => ((b as unknown as { changes: unknown }).changes = JSON.parse('{"__proto__":{"x":1}}'))],
  ])("rejects %s", (_, mutate) => {
    const body = valid();
    mutate(body);
    expect(parseSyncRequest(body, NOW).ok).toBe(false);
  });

  test("rejects oversized batches", () => {
    const body = valid();
    body.changes.checkIns = Array.from({ length: 5001 }, () => body.changes.checkIns[0]!);
    expect(parseSyncRequest(body, NOW).ok).toBe(false);
  });
});

describe("auth payloads", () => {
  test("normalizes emails", () => {
    expect(normalizeEmail("  Yahir@Example.COM ")).toEqual({ ok: true, value: "yahir@example.com" });
    expect(normalizeEmail("a@b").ok).toBe(false);
    expect(normalizeEmail("a@b.com\r\nBcc: x@y.com").ok).toBe(false);
    expect(normalizeEmail(`${"a".repeat(250)}@b.com`).ok).toBe(false);
  });

  test("magic link defaults locale", () => {
    expect(parseMagicLinkRequest({ email: "a@b.co", locale: "xx" })).toEqual({
      ok: true,
      value: { email: "a@b.co", locale: "en" },
    });
  });

  test("verify accepts code or token only", () => {
    expect(parseVerifyRequest({ requestId: ARC, code: "123456" }).ok).toBe(true);
    expect(parseVerifyRequest({ requestId: ARC, code: "12345" }).ok).toBe(false);
    expect(parseVerifyRequest({ token: "a".repeat(43) }).ok).toBe(true);
    expect(parseVerifyRequest({ token: "short" }).ok).toBe(false);
  });
});

describe("merge", () => {
  test("last write wins, ties keep current", () => {
    expect(incomingWins({ updatedAt: "2026-10-01T00:00:00Z" }, { updatedAt: "2026-10-02T00:00:00Z" })).toBe(true);
    expect(incomingWins({ updatedAt: "2026-10-02T00:00:00Z" }, { updatedAt: "2026-10-02T00:00:00Z" })).toBe(false);
  });

  test("merges check-ins by habit and date", () => {
    const a: SyncChanges = {
      ...emptyChanges(),
      checkIns: [{ habitId: HABIT, date: "2026-10-01", done: true, updatedAt: "2026-10-01T09:00:00Z" }],
    };
    const b: SyncChanges = {
      ...emptyChanges(),
      checkIns: [
        { habitId: HABIT, date: "2026-10-01", done: false, updatedAt: "2026-10-01T10:00:00Z" },
        { habitId: HABIT, date: "2026-10-02", done: true, updatedAt: "2026-10-02T09:00:00Z" },
      ],
    };
    const merged = mergeChanges(a, b);
    expect(merged.checkIns).toHaveLength(2);
    expect(merged.checkIns.find((c) => c.date === "2026-10-01")?.done).toBe(false);
    expect(mergeChanges(b, a).checkIns.find((c) => c.date === "2026-10-01")?.done).toBe(false);
  });
});
