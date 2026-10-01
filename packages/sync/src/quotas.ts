/**
 * Kept dependency-free on purpose: apps/functions imports this file directly (Cloud Build can't
 * resolve `workspace:*` packages), and everything it imports is bundled into lib/index.js.
 */
/**
 * Per-user storage caps enforced by the server (tombstones count): Cloud Functions count arcs and
 * habits as they are created and recount check-ins daily; an account over a cap is blocked
 * (`blocked/{uid}`), which the Firestore rules honour. Single source for app and functions.
 */
export const QUOTAS = {
  arcs: 50,
  habits: 500,
  checkIns: 50_000,
} as const;
