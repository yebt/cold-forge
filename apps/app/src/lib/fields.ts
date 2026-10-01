import { LIMITS, SYNC_PROTOCOL_VERSION, isBlank, isEmoji, parseSyncRequest } from "@cold-forge/sync";
import { cleanText, codePointLength } from "./text.ts";

/**
 * User-editable text fields, checked with exactly the rules the API applies (we run a probe
 * record through the shared `parseSyncRequest`), so nothing the app saves can later make a sync
 * fail with 400 invalid_request.
 */
export type TextField = "name" | "why" | "displayName";
export type FieldProblem = "blank" | "tooLong" | "invalid";

export const FIELD_MAX: Record<TextField, number> = {
  name: LIMITS.nameLength,
  why: LIMITS.whyLength,
  displayName: LIMITS.displayNameLength,
};

export const FALLBACK_EMOJI = "🔥";
export const FALLBACK_HABIT_NAME = "Habit";

const PROBE_ID = "00000000-0000-4000-8000-000000000000";
const PROBE_TS = "2000-01-01T00:00:00.000Z";

/** Would the API accept `value` in this field? */
export function serverAcceptsText(field: TextField, value: string): boolean {
  const changes =
    field === "name"
      ? {
          arcs: [],
          habits: [{ id: PROBE_ID, arcId: PROBE_ID, name: value, emoji: FALLBACK_EMOJI, order: 0, createdAt: PROBE_TS, updatedAt: PROBE_TS }],
          checkIns: [],
          profile: null,
        }
      : field === "why"
        ? {
            arcs: [{ id: PROBE_ID, kind: "custom", startDate: "2000-01-01", endDate: "2000-01-02", why: value, createdAt: PROBE_TS, updatedAt: PROBE_TS }],
            habits: [],
            checkIns: [],
            profile: null,
          }
        : {
            arcs: [],
            habits: [],
            checkIns: [],
            profile: { displayName: value, locale: "en", currentArcId: null, updatedAt: PROBE_TS },
          };
  return parseSyncRequest({ protocol: SYNC_PROTOCOL_VERSION, cursor: null, changes }, Date.parse(PROBE_TS)).ok;
}

/**
 * Input-time check of what the user typed (before trimming). `required`: a habit name can't be
 * blank; why and display name can be empty.
 */
export function checkField(field: TextField, value: string, required = field === "name"): FieldProblem | null {
  const v = value.trim();
  if (required && (v === "" || isBlank(v))) return "blank";
  if (codePointLength(v) > FIELD_MAX[field]) return "tooLong";
  // Not blank but renders as nothing (e.g. only zero-width spaces).
  if (v !== "" && isBlank(v)) return required ? "blank" : "invalid";
  if (!serverAcceptsText(field, v)) return "invalid";
  return null;
}

export function checkEmoji(value: string): boolean {
  return isEmoji(value.trim());
}

/** Best-effort repair of a stored value into something the API accepts ("" if nothing is left). */
export function repairText(field: TextField, value: string): string {
  let v = cleanText(value, FIELD_MAX[field], field === "why");
  if (v !== "" && isBlank(v)) v = "";
  return serverAcceptsText(field, v) ? v : "";
}

export function repairEmoji(value: string): string {
  return isEmoji(value) ? value : FALLBACK_EMOJI;
}

/** A habit name to store: blank custom names fall back to "Habit" (template habits may be blank). */
export function repairHabitName(value: string, hasTemplate: boolean): string {
  const v = repairText("name", value);
  return v || hasTemplate ? v : FALLBACK_HABIT_NAME;
}
