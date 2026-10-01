/**
 * Wire contract of the admin callables. Type-only and dependency-free so `apps/admin` can import it
 * (`import type`) without pulling server code into the browser bundle.
 */

export interface UserCountsDto {
  arcs: number;
  habits: number;
  checkIns: number;
}

export interface UserRowDto {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  /** Only https URLs are passed through. */
  photoURL: string | null;
  disabled: boolean;
  createdAt: string | null;
  lastSignIn: string | null;
  providers: string[];
  admin: boolean;
  counts: UserCountsDto | null;
}

export interface ListUsersRequest {
  pageToken?: string | null;
  pageSize?: number;
  query?: string | null;
}

export interface ListUsersResponse {
  users: UserRowDto[];
  nextPageToken: string | null;
  /** `page`: plain listing. `exact`: email/uid lookup. `search`: substring scan over `scanned` accounts. */
  mode: "page" | "exact" | "search";
  scanned: number;
  /** Search found more matches than one response can hold; refine the query. */
  truncated: boolean;
}

export interface ProfileDto {
  displayName: string | null;
  locale: string | null;
  currentArcId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface UserDetailResponse {
  user: UserRowDto;
  profile: ProfileDto | null;
  lastRefresh: string | null;
}

export interface SetDisabledRequest {
  uid: string;
  disabled: boolean;
  reason: string;
}

export interface DeleteUserRequest {
  uid: string;
  /** Must equal the target's email (case-insensitive), or its uid if it has no email. */
  confirm: string;
  reason?: string | null;
}

export interface SetAdminRequest {
  uid: string;
  admin: boolean;
  reason?: string | null;
}

export interface MutationResponse {
  ok: true;
  user: UserRowDto | null;
}

export interface StatsResponse {
  totalUsers: number;
  /** True when the account scan hit its cap; numbers are then lower bounds. */
  usersCapped: boolean;
  disabledUsers: number;
  admins: number;
  signups7d: number;
  signups30d: number;
  active7d: number;
  totals: UserCountsDto;
  generatedAt: string;
}

export type AuditActionDto = "user.view" | "user.disable" | "user.enable" | "user.delete" | "admin.grant" | "admin.revoke" | "unknown";

export interface AuditEntryDto {
  id: string;
  actorUid: string;
  actorEmail: string;
  action: AuditActionDto;
  targetUid: string;
  targetEmail: string | null;
  reason: string | null;
  /** `refused`: a deliberate refusal, nothing changed; `code` says why. */
  outcome: "ok" | "error" | "refused";
  /** Refusal code (self-action, target-is-admin, confirm-mismatch, recent-login-required, rate-limited). */
  code: string | null;
  at: string | null;
}

export interface ListAuditRequest {
  pageToken?: string | null;
  pageSize?: number;
}

export interface ListAuditResponse {
  entries: AuditEntryDto[];
  nextPageToken: string | null;
}

/** Callable names → [request, response]. */
export interface AdminCallables {
  adminListUsers: [ListUsersRequest, ListUsersResponse];
  adminGetUser: [{ uid: string }, UserDetailResponse];
  adminSetDisabled: [SetDisabledRequest, MutationResponse];
  adminDeleteUser: [DeleteUserRequest, MutationResponse];
  adminSetAdmin: [SetAdminRequest, MutationResponse];
  adminStats: [Record<string, never> | undefined, StatsResponse];
  adminListAuditLog: [ListAuditRequest, ListAuditResponse];
}

export type AdminCallableName = keyof AdminCallables;

/** `HttpsError.details` sent with deliberate refusals. */
export interface AdminErrorDetails {
  reason?:
    | "recent-login-required"
    | "self-action"
    | "target-is-admin"
    | "confirm-mismatch"
    | "session-revoked"
    | "rate-limited"
    | "allowlist-not-configured";
}
