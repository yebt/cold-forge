import { describe, expect, test } from "bun:test";
import { checkInKey, deleteHabit, setCheckIn, type AppData } from "./model.ts";
import { MAX_IMPORT_BYTES, parseImportText, prepareImport, readImportFile } from "./importData.ts";
import { parseAppData } from "./parse.ts";
import { exportJSON } from "./repository.ts";
import { T0, T1, T2, T3, makeData, uid } from "./sync/testkit.ts";

function sample(): AppData {
  const d = makeData();
  return setCheckIn(setCheckIn(d, d.habits[0]!.id, "2026-10-01", true, T1), d.habits[1]!.id, "2026-10-01", true, T1);
}

const raw = (d: AppData) => JSON.parse(JSON.stringify(d)) as Record<string, any>;
const envelope = (data: unknown) => JSON.stringify({ exportedAt: T0, app: "cold-forge", data });
const errorOf = (text: string) => {
  const r = parseImportText(text);
  return r.ok ? "ok" : r.error;
};

describe("import validation", () => {
  test("accepts our own export and shows a summary", () => {
    const d = sample();
    const r = parseImportText(exportJSON(d));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual(d);
    expect(r.summary).toEqual({ kind: "winter", startDate: "2026-10-01", endDate: "2026-12-31", habits: 2, checkIns: 2 });
  });

  test("accepts bare AppData", () => {
    expect(errorOf(JSON.stringify(sample()))).toBe("ok");
  });

  test("rejects oversized files before reading them", async () => {
    let read = false;
    const file = {
      size: MAX_IMPORT_BYTES + 1,
      text: async () => {
        read = true;
        return "{}";
      },
    };
    expect(await readImportFile(file)).toEqual({ ok: false, error: "too_large" });
    expect(read).toBe(false);
    // A lying `size` is caught after reading too.
    expect(errorOf(" ".repeat(MAX_IMPORT_BYTES + 1))).toBe("too_large");
  });

  test("reads a valid small file", async () => {
    const text = exportJSON(sample());
    const r = await readImportFile({ size: text.length, text: async () => text });
    expect(r.ok).toBe(true);
  });

  test("rejects bad JSON and the wrong envelope", () => {
    expect(errorOf("{not json")).toBe("not_json");
    expect(errorOf("")).toBe("not_json");
    expect(errorOf("[1,2]")).toBe("wrong_format");
    expect(errorOf("null")).toBe("wrong_format");
    expect(errorOf(JSON.stringify({ app: "other-app", data: sample() }))).toBe("wrong_format");
    expect(errorOf(JSON.stringify({ app: "cold-forge", data: "x" }))).toBe("wrong_format");
    expect(errorOf(JSON.stringify({ hello: "world" }))).toBe("wrong_format");
    expect(errorOf(envelope({ ...raw(sample()), version: 2 }))).toBe("invalid");
  });

  test("rejects over-long strings (a real export can't contain them)", () => {
    const long = raw(sample());
    long.habits[0].name = "x".repeat(61);
    expect(errorOf(envelope(long))).toBe("invalid");
    const why = raw(sample());
    why.arc.why = "y".repeat(281);
    expect(errorOf(envelope(why))).toBe("invalid");
    const name = raw(sample());
    name.settings.displayName = "n".repeat(41);
    expect(errorOf(envelope(name))).toBe("invalid");
  });

  test("repairs invisible/bidi/control characters and bad emoji instead of failing sync later", () => {
    for (const [bad, fixed] of [
      ["evil\u202Egnp.exe", "evilgnp.exe"],
      ["a\u0000b", "ab"],
      ["line\nbreak", "line break"],
      ["\u2066x", "x"],
      ["zero\u200Bwidth", "zerowidth"],
      ["\u200B\u200B", "Habit"], // renders as nothing -> fallback name
    ] as const) {
      const d = raw(sample());
      d.habits[0].name = bad;
      const r = parseImportText(envelope(d));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.habits[0]!.name).toBe(fixed);
    }
    const emoji = raw(sample());
    emoji.habits[0].emoji = "🔥".repeat(17);
    const r = parseImportText(envelope(emoji));
    expect(r.ok && r.data.habits[0]!.emoji).toBe("🔥");
    // The why may keep line breaks.
    const ok = raw(sample());
    ok.arc.why = "line one\nline two";
    const w = parseImportText(envelope(ok));
    expect(w.ok && w.data.arc.why).toBe("line one\nline two");
  });

  test("rejects bad ids, dates, timestamps and too many records", () => {
    const badId = raw(sample());
    badId.habits[0].id = "<img src=x onerror=alert(1)>";
    expect(errorOf(envelope(badId))).toBe("invalid");
    const badDate = raw(sample());
    badDate.arc.endDate = "2026-02-30";
    expect(errorOf(envelope(badDate))).toBe("invalid");
    const badTs = raw(sample());
    badTs.arc.updatedAt = "yesterday";
    expect(errorOf(envelope(badTs))).toBe("invalid");
    const dup = raw(sample());
    dup.habits[1].id = dup.habits[0].id;
    expect(errorOf(envelope(dup))).toBe("invalid");
    const many = raw(sample());
    many.habits = Array.from({ length: 501 }, (_, i) => ({ ...many.habits[0], id: uid(), order: i }));
    expect(errorOf(envelope(many))).toBe("invalid");
    const order = raw(sample());
    order.habits[0].order = 1e9;
    expect(errorOf(envelope(order))).toBe("invalid");
  });

  test("drops check-ins of unknown habits", () => {
    const d = raw(sample());
    const ghost = uid();
    d.checkIns[`${ghost}|2026-10-01`] = { habitId: ghost, date: "2026-10-01", done: true, updatedAt: T1 };
    const r = parseImportText(envelope(d));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.data.checkIns)).toHaveLength(2);
    expect(Object.values(r.data.checkIns).some((c) => c.habitId === ghost)).toBe(false);
  });

  test("re-keys check-ins and ignores the file's keys", () => {
    const d = raw(sample());
    const [first] = Object.values(d.checkIns) as { habitId: string; date: string }[];
    d.checkIns = { whatever: first };
    const r = parseImportText(envelope(d));
    expect(r.ok && Object.keys(r.data.checkIns)).toEqual([checkInKey(first!.habitId, first!.date)]);
  });

  test("drops unknown fields and is immune to prototype pollution", () => {
    const text = envelope(sample()).replace(
      '"version": 1',
      '"version": 1, "__proto__": { "polluted": true }, "constructor": { "prototype": { "polluted": true } }, "extra": "<script>alert(1)</script>"',
    );
    // Also a check-in keyed __proto__ and an injected field on a habit.
    const obj = JSON.parse(text);
    obj.data.checkIns = JSON.parse(
      `{"__proto__": ${JSON.stringify(Object.values(obj.data.checkIns)[0])}}`,
    );
    obj.data.habits[0].isAdmin = true;
    const r = parseImportText(JSON.stringify(obj).replace('"extra"', '"__proto__":{"polluted":true},"extra"'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(r.data, "extra")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(r.data, "__proto__")).toBe(false);
    expect(Object.getPrototypeOf(r.data)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(r.data.checkIns)).toBe(Object.prototype);
    expect("isAdmin" in r.data.habits[0]!).toBe(false);
    expect(Object.keys(r.data.checkIns)[0]).not.toBe("__proto__");
  });
});

describe("storage parsing is forgiving about text", () => {
  test("repairs long or control-character text instead of losing everything", () => {
    const d = raw(sample());
    d.habits[0].name = "Gym‮" + "x".repeat(100);
    d.settings.displayName = "a\u0000b";
    const parsed = parseAppData(d);
    expect(parsed?.habits[0]!.name).toBe("Gym" + "x".repeat(57));
    expect(parsed?.settings.displayName).toBe("ab");
    expect(parseAppData(d, "import")).toBeNull();
  });
});

describe("prepareImport", () => {
  test("bumps every timestamp so the import wins the next sync", () => {
    const imported = sample();
    const next = prepareImport(makeData(), imported, T3);
    expect(next.arc.updatedAt).toBe(T3);
    expect(next.habits.every((h) => h.updatedAt === T3)).toBe(true);
    expect(Object.values(next.checkIns).every((c) => c.updatedAt === T3)).toBe(true);
    expect(next.settings.profileUpdatedAt).toBe(T3);
    expect(next.arc.id).toBe(imported.arc.id);
  });

  test("keeps this device's prefs", () => {
    const current = makeData();
    current.settings.sound = false;
    current.settings.reminderEnabled = true;
    const next = prepareImport(current, sample(), T3);
    expect(next.settings.sound).toBe(false);
    expect(next.settings.reminderEnabled).toBe(true);
  });

  test("same arc: what the backup doesn't have is deleted / unchecked", () => {
    const backup = sample();
    let current = setCheckIn(backup, backup.habits[0]!.id, "2026-10-02", true, T2);
    current = { ...current, habits: [...current.habits, { ...current.habits[0]!, id: uid(), name: "New" }] };
    const next = prepareImport(current, backup, T3);
    expect(next.checkIns[checkInKey(backup.habits[0]!.id, "2026-10-02")]).toEqual({
      habitId: backup.habits[0]!.id,
      date: "2026-10-02",
      done: false,
      updatedAt: T3,
    });
    expect(next.habits.find((h) => h.name === "New")?.deletedAt).toBe(T3);
    // Deleted habits in the backup stay deleted.
    const withDeleted = deleteHabit(backup, backup.habits[1]!.id, T2);
    expect(prepareImport(current, withDeleted, T3).habits.find((h) => h.id === backup.habits[1]!.id)?.deletedAt).toBe(T2);
  });
});
