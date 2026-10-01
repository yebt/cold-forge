/** Regression tests for the security review: M2 (emails), L2 (surrogates), L3 (invisibles/emoji), timestamps. */
import { describe, expect, test } from "bun:test";
import { HABIT_TEMPLATES } from "@cold-forge/core";
import { LIMITS, WRITE_BOUNDS, canonicalTimestamp, checkInDateWritable, isBlank, isEmoji, normalizeEmail, parseSyncRequest } from "./index.ts";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const ARC = "11111111-1111-4111-8111-111111111111";
const HABIT = "22222222-2222-4222-8222-222222222222";
const TS = "2026-10-01T08:00:00.000Z";

const habit = (o: Record<string, unknown> = {}) => ({
  id: HABIT,
  arcId: ARC,
  name: "Cold shower",
  emoji: "🧊",
  order: 0,
  createdAt: TS,
  updatedAt: TS,
  ...o,
});
const arc = (o: Record<string, unknown> = {}) => ({
  id: ARC,
  kind: "winter",
  startDate: "2026-10-01",
  endDate: "2026-12-31",
  why: "x",
  createdAt: TS,
  updatedAt: TS,
  ...o,
});
const parse = (changes: Record<string, unknown>, cursor: unknown = null) =>
  parseSyncRequest({ protocol: 1, cursor, changes: { arcs: [], habits: [], checkIns: [], profile: null, ...changes } }, NOW);
const email = (v: string) => {
  const r = normalizeEmail(v);
  return r.ok ? r.value : null;
};

describe("M2: normalizeEmail", () => {
  test("PoC emails: canonical values", () => {
    expect(email(" Yahir@Example.com ")).toBe("yahir@example.com");
    expect(email("victim+1@gmail.com")).toBe("victim+1@gmail.com");
    expect(email("a'b@example.com")).toBe("a'b@example.com");
    expect(email("victim@localhost.localdomain")).toBe("victim@localhost.localdomain");
    // IDNA: Unicode and punycode spellings are one value (ASCII is what is stored)
    expect(email("victim@exämple.com")).toBe("victim@xn--exmple-cua.com");
    expect(email("victim@xn--exmple-cua.com")).toBe("victim@xn--exmple-cua.com");
    expect(email("victim@EXÄMPLE.com")).toBe("victim@xn--exmple-cua.com");
    // NFC and NFD forms of café (in the domain) fold to one value
    expect(email("u@café.example")).toBe("u@xn--caf-dma.example");
    expect(email("u@café.example")).toBe("u@xn--caf-dma.example");
    // full-width letters and the ideographic full stop map through IDNA
    expect(email("x@ｅｘａｍｐｌｅ.com")).toBe("x@example.com");
    // a Cyrillic lookalike is a different (real) domain, stored visibly as punycode
    expect(email("victim@exаmple.com")).toBe("victim@xn--exmple-4nf.com");
  });

  test("PoC emails: rejected", () => {
    const bad = [
      "victim@example.com.", // trailing dot
      "victim@example..com",
      ".victim@example.com",
      "victim.@example.com",
      "vic..tim@example.com",
      "victim@-example.com",
      "victim@example-.com",
      "victim@[127.0.0.1]",
      "victim@127.0.0.1",
      "victim@0x7f.1",
      "victim@example.123",
      "victim@example",
      "victim@example.com:25",
      "victim@exa_mple.com",
      "victim@exa%41mple.com",
      "café@example.com", // non-ASCII local part
      "café@example.com",
      "İnfo@example.com",
      "=?utf-8?q?x?=@example.com",
      "victim＠example.com", // full-width @
      "a@b@example.com",
      "x@a.b‮",
      "a\u0085b@example.com", // C1
      "a b@example.com",
      "victim@example.com\ud800", // lone surrogate
      `${"a".repeat(65)}@example.com`,
      `a@${"b".repeat(64)}.com`,
      `a@${Array.from({ length: 60 }, () => "abcd").join(".")}.com`, // > 254 total
    ];
    for (const v of bad) expect([v, email(v)]).toEqual([v, null]);
  });

  test("PoC variants: invisible suffixes/infixes never create a second address", () => {
    const invisibles = [
      "​", // zero-width space
      "‌",
      "‍",
      "­", // soft hyphen
      "⁠", // word joiner
      "️", // variation selector
      "͏", // combining grapheme joiner
      "﻿",
      "‎",
      "‮",
      "ᅟ",
      "᠎",
      "\u{e0041}",
    ];
    for (const ch of invisibles) {
      for (const v of [`victim@example.com${ch}`, `victim${ch}@example.com`, `victim@exa${ch}mple.com`, `${ch}victim@example.com`]) {
        const r = email(v);
        if (r !== null) expect(r).toBe("victim@example.com");
        else expect(r).toBeNull();
      }
      expect(email(`victim@example.com${ch}`)).toBeNull();
    }
  });
});

describe("timestamps round-trip", () => {
  test("accept with or without milliseconds, canonicalized to 3 digits", () => {
    expect(canonicalTimestamp("2026-10-01T08:00:00Z")).toBe("2026-10-01T08:00:00.000Z");
    expect(canonicalTimestamp("2026-10-01T08:00:00.5Z")).toBe("2026-10-01T08:00:00.500Z");
    expect(canonicalTimestamp("2026-10-01T08:00:00.123Z")).toBe("2026-10-01T08:00:00.123Z");
    const r = parse({ arcs: [arc({ updatedAt: "2026-10-01T08:00:00Z" })] });
    expect(r.ok && r.value.changes.arcs[0]!.updatedAt).toBe("2026-10-01T08:00:00.000Z");
  });

  test("impossible dates and times are rejected", () => {
    for (const t of ["2026-02-30T00:00:00Z", "2026-01-01T24:00:00Z", "2026-06-30T23:59:60Z", "2026-13-01T00:00:00Z", "2026-10-01T08:00:00.1234Z"]) {
      expect(canonicalTimestamp(t)).toBeNull();
      expect(parse({ arcs: [arc({ updatedAt: t })] }).ok).toBe(false);
    }
    expect(canonicalTimestamp("2024-02-29T00:00:00Z")).toBe("2024-02-29T00:00:00.000Z");
  });
});

describe("L2: lone surrogates", () => {
  test("PoC sur: rejected in text, emoji and cursor", () => {
    for (const s of ["a\ud800b", "\ud800", "\udc00", "é\ud800", "\ud800\ud800"]) {
      expect(parse({ habits: [habit({ name: s })] }).ok).toBe(false);
      expect(parse({ arcs: [arc({ why: s })] }).ok).toBe(false);
      expect(parse({ habits: [habit({ emoji: `🧊${s}` })] }).ok).toBe(false);
      expect(parse({}, `v1.0${s}`).ok).toBe(false);
    }
    expect(parse({ habits: [habit({ name: "ok 𝄞 surrogate pair" })] }).ok).toBe(true);
  });
});

describe("L3: invisible and spoofing characters", () => {
  test("invisibles are rejected in text fields", () => {
    const chars = [
      "​", "‌", "‍", "‎", "‏",
      " ", " ", "‪", "‮",
      "⁠", "⁡", "⁤",
      "﻿", "؜", "᠎", "­",
      "\u{e0001}", "\u{e0041}", "\u{e007f}",
      "⁦", "⁩",
    ];
    for (const ch of chars) {
      expect([ch.codePointAt(0)!.toString(16), parse({ habits: [habit({ name: `a${ch}b` })] }).ok]).toEqual([
        ch.codePointAt(0)!.toString(16),
        false,
      ]);
      expect(parse({ arcs: [arc({ why: `a${ch}b` })] }).ok).toBe(false);
    }
  });

  test("4+ combining marks in a row are rejected (zalgo); a few are fine", () => {
    expect(parse({ habits: [habit({ name: "a" + "̶".repeat(59) })] }).ok).toBe(false);
    expect(parse({ habits: [habit({ name: "á̂̃̄" })] }).ok).toBe(false);
    expect(parse({ habits: [habit({ name: "Ação diária" })] }).ok).toBe(true);
    expect(parse({ habits: [habit({ name: "Café" })] }).ok).toBe(true);
  });

  test("emptiness treats invisibles as empty", () => {
    expect(isBlank("   ")).toBe(true);
    expect(isBlank("ㅤ")).toBe(true);
    expect(isBlank("⠀")).toBe(true);
    expect(isBlank("️͏")).toBe(true);
    expect(isBlank("a")).toBe(false);
    // custom habits need a visible name
    for (const n of ["", " ", "ㅤ", "⠀⠀", "️"]) {
      expect(parse({ habits: [habit({ name: n })] }).ok).toBe(false);
    }
    // template habits may leave the name empty (the app shows the localized template name)
    expect(parse({ habits: [habit({ name: "", templateId: "gym" })] }).ok).toBe(true);
  });

  test("emoji field: 1–2 emoji graphemes; ZWJ/VS/flags/keycaps allowed there only", () => {
    for (const ok of ["🧊", "🏋️", "1️⃣", "#️⃣", "👨‍👩‍👧‍👦", "🇲🇽", "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "👍🏽", "❤️", "🧊🔥", "©️"]) {
      expect([ok, isEmoji(ok)]).toEqual([ok, true]);
    }
    for (const bad of ["", "x", "DROP TABLE x", "​", "🧊🔥💧", "🧊​", "️🧊", "🧊\u{e0041}", "🧊‮", "🧊\n", "1", "🧊" + "́".repeat(4), "a🧊"]) {
      expect([bad, isEmoji(bad)]).toEqual([bad, false]);
    }
    // ZWJ is still rejected outside the emoji field
    expect(parse({ habits: [habit({ name: "👨‍👩‍👧" })] }).ok).toBe(false);
    expect(parse({ habits: [habit({ emoji: "👨‍👩‍👧" })] }).ok).toBe(true);
  });

  test("every habit template emoji validates", () => {
    const emojis = HABIT_TEMPLATES.map((t) => t.emoji);
    expect(emojis).toEqual(["🧊", "🏋️", "📚", "⏰", "🚫", "📵", "🧘", "🚶", "💧", "📓"]);
    for (const t of HABIT_TEMPLATES) {
      expect([t.emoji, isEmoji(t.emoji)]).toEqual([t.emoji, true]);
      expect(parse({ habits: [habit({ templateId: t.id, name: "", emoji: t.emoji })] }).ok).toBe(true);
    }
  });
});

describe("H1: write bounds (mirror of firebase/firestore.rules)", () => {
  const checkIn = (date: string, o: Record<string, unknown> = {}) => ({ habitId: HABIT, date, done: true, updatedAt: TS, ...o });
  const DAY = 86_400_000;
  const day = (offset: number) => new Date(NOW + offset * DAY).toISOString().slice(0, 10);

  test("check-in dates within [now - 400 d, now + 2 d]", () => {
    for (const d of ["9999-12-31", "0001-01-01", "1900-01-01", day(-402), day(3)]) expect([d, parse({ checkIns: [checkIn(d)] }).ok]).toEqual([d, false]);
    for (const d of [day(-399), day(0), day(1)]) expect([d, parse({ checkIns: [checkIn(d)] }).ok]).toEqual([d, true]);
    expect(checkInDateWritable(day(-399), NOW)).toBe(true);
    expect(checkInDateWritable(day(-401), NOW)).toBe(false);
  });

  test("arcs start on/after 2024-01-01 and span at most 366 days", () => {
    expect(parse({ arcs: [arc({ startDate: "0001-01-01", endDate: "9999-12-31" })] }).ok).toBe(false);
    expect(parse({ arcs: [arc({ startDate: "2023-12-31", endDate: "2024-01-31" })] }).ok).toBe(false);
    expect(parse({ arcs: [arc({ startDate: "2024-01-01", endDate: "2024-12-31" })] }).ok).toBe(true); // 366 days
    expect(parse({ arcs: [arc({ startDate: "2026-01-01", endDate: "2027-01-02" })] }).ok).toBe(false); // 367
  });

  test("timestamps from 2024 on, createdAt <= updatedAt", () => {
    expect(parse({ arcs: [arc({ createdAt: "2023-12-31T23:59:59.999Z" })] }).ok).toBe(false);
    expect(parse({ checkIns: [checkIn(day(0), { updatedAt: "0001-01-01T00:00:00.000Z" })] }).ok).toBe(false);
    expect(parse({ habits: [habit({ createdAt: "2026-10-02T00:00:00.000Z", updatedAt: TS })] }).ok).toBe(false);
    expect(parse({ arcs: [arc({ deletedAt: "2023-01-01T00:00:00.000Z" })] }).ok).toBe(false);
  });

  test("data read back (bounds: false) is not subject to the write window", () => {
    const old = { protocol: 1, cursor: null, changes: { arcs: [], habits: [], checkIns: [checkIn("2024-02-01")], profile: null } };
    expect(parseSyncRequest(old, NOW).ok).toBe(false);
    expect(parseSyncRequest(old, NOW, { bounds: false }).ok).toBe(true);
    expect(WRITE_BOUNDS).toEqual({ minDate: "2024-01-01", minTimestamp: "2024-01-01T00:00:00.000Z", maxArcDays: 366, checkInPastDays: 400, checkInFutureDays: 2 });
  });
});

describe("L1: lengths are UTF-16 code units (like the rules' string.size())", () => {
  test("30 × 💪 is a valid name, 31 is not; the emoji field holds at most 16 units", () => {
    expect(parse({ habits: [habit({ name: "💪".repeat(30) })] }).ok).toBe(true);
    expect(parse({ habits: [habit({ name: "💪".repeat(31) })] }).ok).toBe(false);
    expect(parse({ arcs: [arc({ why: "😀".repeat(140) })] }).ok).toBe(true);
    expect(parse({ arcs: [arc({ why: "😀".repeat(141) })] }).ok).toBe(false);
    expect(isEmoji("👨‍👩‍👧‍👦👨‍👩‍👧‍👦")).toBe(false); // 22 units
    expect(LIMITS).toMatchObject({ nameLength: 60, whyLength: 280, displayNameLength: 40, emojiLength: 16 });
  });

  test("names and display names of only space separators are blank (NBSP, U+3000, U+2000…)", () => {
    for (const b of ["  ", "　", "  ", " "]) {
      expect(parse({ habits: [habit({ name: b })] }).ok).toBe(false);
      expect(parse({ habits: [habit({ name: b, templateId: "gym" })] }).ok).toBe(false);
      expect(parse({ profile: { displayName: b, locale: "en", currentArcId: null, updatedAt: TS } }).ok).toBe(false);
    }
    expect(parse({ profile: { displayName: "", locale: "en", currentArcId: null, updatedAt: TS } }).ok).toBe(true);
  });

  test("emoji: strict code points, no text after the emoji", () => {
    for (const bad of ["🔥 hello world!!", "🔥<img src=x>", "©abcdefghijklmno", "⠀"]) expect([bad, isEmoji(bad)]).toEqual([bad, false]);
  });
});
