/**
 * The narrow surface the admin service needs from Firebase. `firebase.ts` implements it with
 * firebase-admin; tests use in-memory fakes. Nothing here ever carries tokens or password hashes.
 */

export interface AuthUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  photoURL: string | null;
  disabled: boolean;
  /** ISO timestamps (or null when Auth doesn't know). */
  createdAt: string | null;
  lastSignIn: string | null;
  lastRefresh: string | null;
  /** Provider ids, e.g. `google.com`. */
  providers: string[];
  admin: boolean;
  /** ISO time before which issued tokens are revoked (Auth `tokensValidAfterTime`). */
  tokensValidAfter: string | null;
}

export interface UserPage {
  users: AuthUser[];
  nextPageToken: string | null;
}

export interface AuthPort {
  getUser(uid: string): Promise<AuthUser | null>;
  getUserByEmail(email: string): Promise<AuthUser | null>;
  /** `maxResults` <= 1000. */
  listUsers(maxResults: number, pageToken: string | null): Promise<UserPage>;
  setDisabled(uid: string, disabled: boolean): Promise<void>;
  revokeRefreshTokens(uid: string): Promise<void>;
  /** Sets or clears the `admin` claim, keeping any other custom claims. */
  setAdminClaim(uid: string, admin: boolean): Promise<void>;
  deleteUser(uid: string): Promise<void>;
}

export interface UserCounts {
  arcs: number;
  habits: number;
  checkIns: number;
}

export interface ProfileView {
  displayName: string | null;
  locale: string | null;
  currentArcId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export type AuditAction =
  | "user.disable"
  | "user.enable"
  | "user.delete"
  | "admin.grant"
  | "admin.revoke";

export interface AuditRecord {
  actorUid: string;
  actorEmail: string;
  action: AuditAction;
  targetUid: string;
  targetEmail: string | null;
  reason: string | null;
  outcome: "ok" | "error";
}

export interface AuditEntry extends Omit<AuditRecord, "action"> {
  id: string;
  /** `unknown` only if a stored document was tampered with or written by a newer version. */
  action: AuditAction | "unknown";
  /** ISO server time. */
  at: string | null;
}

export interface AuditPage {
  entries: AuditEntry[];
  nextPageToken: string | null;
}

export interface RateRule {
  limit: number;
  windowMs: number;
}

export interface DataPort {
  countUserData(uid: string): Promise<UserCounts>;
  getProfile(uid: string): Promise<ProfileView | null>;
  /** Recursively deletes `users/{uid}` and everything under it. */
  deleteUserData(uid: string): Promise<void>;
  /** Number of `users/{uid}` docs whose `updatedAt` (ISO string) is >= `sinceIso`. */
  countProfilesUpdatedSince(sinceIso: string): Promise<number>;
  /** Collection-group totals across all users. */
  countAllData(): Promise<UserCounts>;
  writeAudit(record: AuditRecord): Promise<void>;
  /** Throws `invalid-argument` when `afterId` doesn't exist. */
  listAudit(pageSize: number, afterId: string | null): Promise<AuditPage>;
  /** Consumes one unit from `key`'s window; false when the limit is exhausted. */
  consumeRateLimit(key: string, rule: RateRule, now: Date): Promise<boolean>;
}
