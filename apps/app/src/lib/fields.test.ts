import { describe, expect, test } from "bun:test";
import { HABIT_TEMPLATES } from "@cold-forge/core";
import { isEmoji } from "@cold-forge/sync";
import { EMOJI_CHOICES } from "../ui/EmojiField.tsx";
import { checkEmoji, checkField, repairEmoji, repairHabitName, repairText, serverAcceptsText } from "./fields.ts";
import { createMemoryStore, createRepository } from "./repository.ts";
import { addHabit, updateHabit, updateSettings, updateWhy } from "./model.ts";
import { validateAppData } from "./parse.ts";
import { T0, T3, makeData } from "./sync/testkit.ts";

describe("input-time checks match the API", () => {
  test("accepts normal text in every language", () => {
    for (const v of ["Gym", "Leer 20 min", "Ducha fría", "Meditação", "ジム", "Run 🏃"]) expect(checkField("name", v)).toBeNull();
    expect(checkField("why", "line one\nline two")).toBeNull();
    expect(checkField("displayName", "")).toBeNull();
    expect(checkField("why", "")).toBeNull();
  });

  test("flags blank, too long and hidden characters", () => {
    expect(checkField("name", "   ")).toBe("blank");
    expect(checkField("name", "​​")).toBe("blank");
    expect(checkField("displayName", "​")).toBe("invalid");
    expect(checkField("name", "x".repeat(61))).toBe("tooLong");
    for (const bad of [
      "zero​width",
      "join‍er",
      "evil‮gnp",
      "line sep",
      "tag\u{E0041}",
      "á́́́", // zalgo
      "lone\uD800",
      "soft­hyphen",
    ]) {
      expect(checkField("name", bad)).toBe("invalid");
      expect(serverAcceptsText("displayName", bad)).toBe(false);
    }
    expect(checkField("name", "tab\there")).toBe("invalid");
  });

  test("emoji: one or two emoji graphemes only", () => {
    for (const ok of ["🔥", "🏋️", "👨‍👩‍👧", "👍🏽", "🇲🇽", "🔥💪"]) expect(checkEmoji(ok)).toBe(true);
    for (const bad of ["", "a", "🔥🔥🔥", "x🔥", "​🔥"]) expect(checkEmoji(bad)).toBe(false);
  });

  test("L1: lengths are UTF-16 units, like the Firestore rules (string.size()) and <input maxLength>", () => {
    expect(checkField("name", "💪".repeat(30))).toBeNull(); // 60 units
    expect(checkField("name", "💪".repeat(31))).toBe("tooLong"); // 62 units, 31 code points
    expect(checkField("displayName", "🔥".repeat(20))).toBeNull();
    expect(checkField("displayName", "🔥".repeat(21))).toBe("tooLong");
    expect(checkField("why", "😀".repeat(140))).toBeNull();
    expect(checkField("why", "😀".repeat(141))).toBe("tooLong");
    // Repairs cut whole characters, never half a surrogate pair or a ZWJ sequence.
    expect(repairText("name", "a" + "💪".repeat(40))).toBe("a" + "💪".repeat(29));
    expect(repairText("name", "x".repeat(57) + "👍🏽")).toBe("x".repeat(57)); // 👍🏽 is 4 units: dropped whole
    expect(checkEmoji("👨‍👩‍👧‍👦👨‍👩‍👧‍👦")).toBe(false); // two graphemes but 22 units > 16
  });

  test("names and display names made only of space separators are blank (C4–C6, C34)", () => {
    for (const b of ["\u00a0\u00a0", "\u3000", "\u2000\u2001", "\u202f"]) {
      expect(checkField("name", b)).toBe("blank");
      expect(serverAcceptsText("displayName", b)).toBe(false);
      expect(repairText("displayName", b)).toBe("");
    }
  });

  test("the emoji picker only offers emoji the rules' strict regex accepts", () => {
    for (const bad of ["🔥 hello world!!", "🔥<img src=x>", "©abcdefghijklmno"]) expect(checkEmoji(bad)).toBe(false);
  });

  test("every picker choice and template emoji is accepted by the API", () => {
    expect(EMOJI_CHOICES.length).toBeGreaterThanOrEqual(40);
    expect(EMOJI_CHOICES.filter((e) => !isEmoji(e))).toEqual([]);
    expect(HABIT_TEMPLATES.filter((t) => !isEmoji(t.emoji))).toEqual([]);
  });
});

describe("repairs", () => {
  test("text, emoji and blank names", () => {
    expect(repairText("name", " a​b‮ ")).toBe("ab");
    expect(repairText("name", "x́́́́́")).toBe("x́́́");
    expect(repairText("displayName", "lone\uD800")).toBe("lone�");
    expect(serverAcceptsText("displayName", repairText("displayName", "lone\uD800"))).toBe(true);
    expect(repairEmoji("nope")).toBe("🔥");
    expect(repairEmoji("💪")).toBe("💪");
    expect(repairHabitName("​", false)).toBe("Habit");
    expect(repairHabitName("", true)).toBe(""); // template habits take their localized name
  });

  test("reducers never store what the API would reject", () => {
    let d = addHabit(makeData(), { name: "Run​‮", emoji: "not emoji" }, T3);
    const h = d.habits.at(-1)!;
    expect(h.name).toBe("Run");
    expect(h.emoji).toBe("🔥");
    d = updateHabit(d, h.id, { emoji: "abc" }, T3);
    expect(d.habits.at(-1)!.emoji).toBe("🔥");
    d = updateSettings(d, { displayName: "Neo⁦" }, T3);
    expect(d.settings.displayName).toBe("Neo");
    d = updateWhy(d, "go on", T3);
    expect(d.arc.why).toBe("goon");
  });

  test("stored data is repaired on load, bumped so the fix syncs, and saved back", async () => {
    const d = makeData();
    const bad = JSON.parse(JSON.stringify(d));
    bad.habits[0].emoji = "nope";
    bad.habits[1].name = "​";
    bad.settings.displayName = "Ya‍hir";
    bad.arc.why = "ok"; // untouched
    bad.arc.updatedAt = "2026-09-30T08:00:00Z"; // canonicalized, not "repaired"
    const r = validateAppData(bad, "storage", T3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.repaired).toBe(3);
    expect(r.data.habits[0]).toMatchObject({ emoji: "🔥", updatedAt: T3 });
    expect(r.data.habits[1]).toMatchObject({ name: "Habit", updatedAt: T3 });
    expect(r.data.settings).toMatchObject({ displayName: "Yahir", updatedAt: T3, profileUpdatedAt: T3 });
    expect(r.data.arc.updatedAt).toBe("2026-09-30T08:00:00.000Z");

    const store = createMemoryStore({ "coldforge.data.v1": JSON.stringify(bad) });
    const loaded = await createRepository(store).load();
    expect(loaded?.habits[0]!.emoji).toBe("🔥");
    expect(JSON.parse((await store.get("coldforge.data.v1"))!).habits[0].emoji).toBe("🔥");
    expect(T0 < T3).toBe(true);
  });

  test("impossible timestamps are still structural errors", () => {
    const bad = JSON.parse(JSON.stringify(makeData()));
    bad.arc.updatedAt = "2026-02-30T00:00:00.000Z";
    expect(validateAppData(bad, "storage").ok).toBe(false);
  });
});
