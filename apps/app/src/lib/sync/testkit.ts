import { createAppData, type AppData } from "../model.ts";

/** Shared fixtures for the sync tests (not shipped: only imported from *.test.ts). */
export const T0 = "2026-10-01T08:00:00.000Z";
export const T1 = "2026-10-02T08:00:00.000Z";
export const T2 = "2026-10-03T08:00:00.000Z";
export const T3 = "2026-10-04T08:00:00.000Z";
export const TODAY = "2026-10-05";

let n = 0;
/** Deterministic UUID-shaped ids. */
export function uid(): string {
  n++;
  const hex = n.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

export function makeData(opts: { name?: string; habits?: number; now?: string } = {}): AppData {
  const data = createAppData(
    {
      kind: "winter",
      window: { startDate: "2026-10-01", endDate: "2026-12-31" },
      habits: Array.from({ length: opts.habits ?? 2 }, (_, i) => ({ name: `Habit ${i + 1}`, emoji: "🔥" })),
      why: "stronger",
      displayName: opts.name ?? "Yahir",
      locale: "es",
    },
    opts.now ?? T0,
  );
  return data;
}
