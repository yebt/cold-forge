import type { RateRule } from "./ports.ts";

/**
 * Fixed-window counter, stored per admin+bucket in `adminRateLimits/{uid}_{bucket}` and updated in
 * a Firestore transaction, so the limit holds across all function instances (an in-memory counter
 * would reset on every cold start and be per-instance).
 */
export interface WindowState {
  windowStart: number;
  count: number;
}

export function consumeWindow(
  state: WindowState | null,
  rule: RateRule,
  nowMs: number,
): { allowed: boolean; next: WindowState } {
  if (!state || !Number.isFinite(state.windowStart) || nowMs - state.windowStart >= rule.windowMs || nowMs < state.windowStart) {
    return { allowed: rule.limit >= 1, next: { windowStart: nowMs, count: 1 } };
  }
  if (state.count >= rule.limit) return { allowed: false, next: state };
  return { allowed: true, next: { windowStart: state.windowStart, count: state.count + 1 } };
}

export const RATE_RULES = {
  /** Read callables (list/get/stats/audit). */
  read: { limit: 60, windowMs: 60_000 },
  /** Mutations (disable/enable/delete/admin). */
  write: { limit: 10, windowMs: 60_000 },
} satisfies Record<string, RateRule>;

export type RateBucket = keyof typeof RATE_RULES;
