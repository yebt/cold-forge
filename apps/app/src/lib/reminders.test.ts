import { describe, expect, test } from "bun:test";
import { en } from "../i18n/en.ts";
import { es } from "../i18n/es.ts";
import { planReminders, REMINDER_HORIZON_DAYS, REMINDER_ID_BASE, type ReminderInput } from "./reminders.ts";

const base: ReminderInput = {
  enabled: true,
  time: "21:00",
  now: new Date(2026, 9, 10, 12, 0), // Oct 10, noon local
  today: "2026-10-10",
  arcStart: "2026-10-01",
  arcEnd: "2026-12-31",
  habitsLeftToday: 2,
  perfectStreak: 5,
};

describe("planReminders", () => {
  test("disabled → nothing", () => {
    expect(planReminders({ ...base, enabled: false }, en.reminder)).toEqual([]);
  });

  test("today plus the next days at the chosen time", () => {
    const plan = planReminders(base, en.reminder);
    expect(plan).toHaveLength(REMINDER_HORIZON_DAYS);
    expect(plan[0]!.id).toBe(REMINDER_ID_BASE);
    expect(plan[0]!.at.getHours()).toBe(21);
    expect(plan[0]!.at.getDate()).toBe(10);
    expect(plan[0]!.body).toBe("2 habits left — don't break your 5-day streak 🔥");
    expect(plan[1]!.body).toContain("5-day streak");
  });

  test("skips today when everything is done or the time has passed", () => {
    expect(planReminders({ ...base, habitsLeftToday: 0 }, en.reminder)[0]!.id).toBe(REMINDER_ID_BASE + 1);
    expect(planReminders({ ...base, now: new Date(2026, 9, 10, 22, 0) }, en.reminder)[0]!.at.getDate()).toBe(11);
  });

  test("no streak → encouraging copy, never shaming", () => {
    const plan = planReminders({ ...base, perfectStreak: 0, habitsLeftToday: 1 }, es.reminder);
    expect(plan[0]!.body).toBe("Te falta 1 hábito hoy. La forja está caliente 🔥");
  });

  test("stops at the end of the arc", () => {
    const plan = planReminders({ ...base, today: "2026-12-29", now: new Date(2026, 11, 29, 8, 0) }, en.reminder);
    expect(plan).toHaveLength(3);
  });

  test("waits for an upcoming arc", () => {
    const plan = planReminders({ ...base, today: "2026-09-25", now: new Date(2026, 8, 25, 8, 0) }, en.reminder);
    expect(plan[0]!.at.getMonth()).toBe(9);
    expect(plan[0]!.at.getDate()).toBe(1);
  });
});
