/** Failures the sync engine understands, whatever the backend. */
export type SyncError =
  /** Offline, timeout, backend unavailable: retry with backoff. */
  | { kind: "network" }
  /** Signed out / session revoked / user deleted elsewhere. */
  | { kind: "unauthorized" }
  /** Too many requests or backend quota (resource-exhausted): wait, then retry. */
  | { kind: "rate_limited"; retryAfterMs: number }
  /**
   * The backend refused the data (Firestore permission-denied: a rule rejected a write, e.g. a
   * stale last-write-wins update or a value it doesn't accept). The engine pulls, re-merges and
   * retries once; after that sync is paused instead of looping.
   */
  | { kind: "rejected" }
  /** The user closed the sign-in / re-auth popup. */
  | { kind: "cancelled" }
  /** Sign-in is continuing via a full-page redirect. */
  | { kind: "redirecting" }
  /** This build has no Firebase config. */
  | { kind: "not_configured" }
  | { kind: "server" };

export type SyncResult<T> = { ok: true; value: T } | { ok: false; error: SyncError };

export const ok = <T>(value: T): SyncResult<T> => ({ ok: true, value });
export const err = <T = never>(error: SyncError): SyncResult<T> => ({ ok: false, error });
