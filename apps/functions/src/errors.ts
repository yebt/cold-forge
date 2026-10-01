/**
 * Errors the admin layer throws on purpose. `index.ts` maps them to `HttpsError` with the same
 * code; anything else becomes a generic `internal` error so library messages never reach clients.
 */
export type AdminErrorCode =
  | "invalid-argument"
  | "unauthenticated"
  | "permission-denied"
  | "not-found"
  | "failed-precondition"
  | "resource-exhausted"
  | "aborted";

/** Machine-readable reasons the admin UI reacts to (sent as `HttpsError.details.reason`). */
export type AdminErrorReason =
  | "recent-login-required"
  | "self-action"
  | "target-is-admin"
  | "confirm-mismatch"
  | "session-revoked"
  | "rate-limited";

export class AdminError extends Error {
  readonly code: AdminErrorCode;
  readonly reason: AdminErrorReason | undefined;

  constructor(code: AdminErrorCode, message: string, reason?: AdminErrorReason) {
    super(message);
    this.name = "AdminError";
    this.code = code;
    this.reason = reason;
  }
}

export const invalid = (message: string) => new AdminError("invalid-argument", message);
