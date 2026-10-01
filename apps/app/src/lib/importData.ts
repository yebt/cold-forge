import type { AppData, CheckInRecord, StoredHabit } from "./model.ts";
import { checkInKey } from "./model.ts";
import { validateAppData } from "./parse.ts";

/** Files over this are rejected before a single byte is read. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export type ImportError = "too_large" | "not_json" | "wrong_format" | "invalid";

export interface ImportSummary {
  kind: AppData["arc"]["kind"];
  startDate: string;
  endDate: string;
  habits: number;
  checkIns: number;
}

export type ImportResult =
  | { ok: true; data: AppData; summary: ImportSummary }
  | { ok: false; error: ImportError; detail?: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function summarize(data: AppData): ImportSummary {
  const alive = new Set(data.habits.filter((h) => !h.deletedAt).map((h) => h.id));
  return {
    kind: data.arc.kind,
    startDate: data.arc.startDate,
    endDate: data.arc.endDate,
    habits: alive.size,
    checkIns: Object.values(data.checkIns).filter((c) => c.done && alive.has(c.habitId)).length,
  };
}

/**
 * Parses the text of an exported file. Accepts the `exportJSON` envelope
 * (`{ app: "cold-forge", data }`) or bare AppData; everything is strictly validated.
 */
export function parseImportText(text: string): ImportResult {
  // `length` counts UTF-16 units, which is >= bytes/3 — a cheap second guard if `size` lied.
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, error: "too_large" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "not_json" };
  }
  if (!isObj(raw)) return { ok: false, error: "wrong_format" };
  let candidate: unknown;
  if ("data" in raw || "app" in raw) {
    if (raw.app !== "cold-forge" || !isObj(raw.data)) return { ok: false, error: "wrong_format" };
    candidate = raw.data;
  } else if ("version" in raw && "arc" in raw) {
    candidate = raw;
  } else {
    return { ok: false, error: "wrong_format" };
  }
  const parsed = validateAppData(candidate, "import");
  if (!parsed.ok) return { ok: false, error: "invalid", detail: parsed.error };
  return { ok: true, data: parsed.data, summary: summarize(parsed.data) };
}

/** Reads a user-picked file, refusing oversized files before reading them. */
export async function readImportFile(file: Pick<Blob, "size" | "text">): Promise<ImportResult> {
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, error: "too_large" };
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: "not_json" };
  }
  return parseImportText(text);
}

/**
 * The data that replaces this device's data. Every record gets `updatedAt = now` so the import
 * wins every last-write-wins merge when it syncs. When the import is the same arc as the current
 * one, records it doesn't have become tombstones / un-checks so "replace" also holds on other
 * devices. Device-only prefs (sound, haptics, reminders) stay as they are on this device.
 */
export function prepareImport(current: AppData | null, imported: AppData, now: string): AppData {
  const habits: StoredHabit[] = imported.habits.map((h) => ({ ...h, updatedAt: now }));
  const checkIns: Record<string, CheckInRecord> = {};
  for (const c of Object.values(imported.checkIns)) checkIns[checkInKey(c.habitId, c.date)] = { ...c, updatedAt: now };

  if (current && current.arc.id === imported.arc.id) {
    const ids = new Set(habits.map((h) => h.id));
    for (const h of current.habits) {
      if (!ids.has(h.id)) habits.push({ ...h, deletedAt: now, updatedAt: now });
    }
    const habitIds = new Set(habits.map((h) => h.id));
    for (const [key, c] of Object.entries(current.checkIns)) {
      if (!(key in checkIns) && c.done && habitIds.has(c.habitId)) checkIns[key] = { ...c, done: false, updatedAt: now };
    }
  }

  const device = current?.settings ?? imported.settings;
  return {
    version: imported.version,
    arc: { ...imported.arc, updatedAt: now },
    habits,
    checkIns,
    settings: {
      locale: imported.settings.locale,
      displayName: imported.settings.displayName,
      sound: device.sound,
      haptics: device.haptics,
      reminderEnabled: device.reminderEnabled,
      reminderTime: device.reminderTime,
      updatedAt: now,
      profileUpdatedAt: now,
    },
    celebratedMilestones: imported.celebratedMilestones,
  };
}
