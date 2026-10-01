import { AdminError } from "./errors.ts";
import type { AuthUser } from "./ports.ts";

/** The subset of a verified Firebase ID token (`request.auth`) the guard reads. */
export interface AuthContext {
  uid: string;
  token: {
    admin?: unknown;
    email?: unknown;
    email_verified?: unknown;
    auth_time?: unknown;
    firebase?: { sign_in_provider?: unknown } | undefined;
    [claim: string]: unknown;
  };
}

export interface GuardConfig {
  /**
   * Lower-cased emails allowed to act as admin, on top of the claim. Empty = every admin call is
   * refused (fail closed) unless `allowAnyAdmin`.
   */
  allowedEmails: readonly string[];
  /** Explicit opt-out of the allowlist (ADMIN_ALLOW_ANY_ADMIN=true, or the emulator). */
  allowAnyAdmin: boolean;
  /** Require the session to come from Google sign-in (default true). */
  requireGoogleProvider: boolean;
}

export interface Actor {
  uid: string;
  email: string;
  /** Seconds since epoch when the user last actually signed in (ID token `auth_time`). */
  authTime: number;
}

/**
 * Stage 1, pure and I/O free: the verified ID token must carry `admin: true`, a verified email,
 * and (by default) a Google sign-in. Runs before anything else so non-admins cost nothing.
 */
export function requireAdmin(auth: AuthContext | undefined | null, config: GuardConfig): Actor {
  if (!auth || typeof auth.uid !== "string" || !auth.token) {
    throw new AdminError("unauthenticated", "Sign in required.");
  }
  const { token } = auth;
  if (token.admin !== true) throw new AdminError("permission-denied", "Not authorized.");
  if (token.email_verified !== true || typeof token.email !== "string" || token.email === "") {
    throw new AdminError("permission-denied", "Not authorized.");
  }
  if (config.requireGoogleProvider && token.firebase?.sign_in_provider !== "google.com") {
    throw new AdminError("permission-denied", "Not authorized.");
  }
  const email = token.email.toLowerCase();
  if (config.allowedEmails.length === 0) {
    // Fail closed: a deploy that forgot the allowlist must not hand admin powers to every claim holder.
    if (!config.allowAnyAdmin) {
      throw new AdminError("permission-denied", "Admin access is not configured.", "allowlist-not-configured");
    }
  } else if (!config.allowedEmails.includes(email)) {
    throw new AdminError("permission-denied", "Not authorized.");
  }
  const authTime = typeof token.auth_time === "number" && Number.isFinite(token.auth_time) ? token.auth_time : 0;
  return { uid: auth.uid, email, authTime };
}

/**
 * Stage 2, against the live Auth record: ID tokens stay valid for up to an hour after an admin is
 * demoted, disabled or has their sessions revoked. Re-reading the account on every call closes
 * that window (the same check `verifyIdToken(token, true)` would do, plus the claim itself).
 */
export function assertLiveAdmin(actor: Actor, live: AuthUser | null): void {
  if (!live || live.uid !== actor.uid) throw new AdminError("permission-denied", "Not authorized.");
  if (live.disabled || !live.admin) throw new AdminError("permission-denied", "Not authorized.");
  if ((live.email ?? "").toLowerCase() !== actor.email) {
    throw new AdminError("permission-denied", "Not authorized.");
  }
  if (live.tokensValidAfter) {
    const validAfterMs = Date.parse(live.tokensValidAfter);
    if (Number.isFinite(validAfterMs) && actor.authTime * 1000 < validAfterMs) {
      throw new AdminError("unauthenticated", "Session revoked. Sign in again.", "session-revoked");
    }
  }
}

/** Destructive actions need a sign-in from the last `maxAgeSeconds` (the UI re-authenticates). */
export function requireRecentLogin(actor: Actor, now: Date, maxAgeSeconds: number): void {
  const ageSeconds = now.getTime() / 1000 - actor.authTime;
  if (!(actor.authTime > 0) || ageSeconds > maxAgeSeconds) {
    throw new AdminError("failed-precondition", "Please sign in again to confirm this action.", "recent-login-required");
  }
}

export function refuseSelf(actor: Actor, targetUid: string, what: string): void {
  if (actor.uid === targetUid) {
    throw new AdminError("failed-precondition", `You cannot ${what} your own account.`, "self-action");
  }
}

/** Parses `ADMIN_ALLOWED_EMAILS` (comma or whitespace separated). */
export function parseEmailList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}
