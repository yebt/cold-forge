import { AdminError } from "./errors.ts";
import type { AuthUser } from "./ports.ts";

/**
 * Who is an admin: exactly the accounts whose email is in `ADMIN_ALLOWED_EMAILS` (a Secret Manager
 * secret), signed in with Google, with a verified email. There is no custom claim and no other way
 * to become an admin: adding or removing someone means changing the secret and redeploying.
 */

/** The subset of a verified Firebase ID token (`request.auth`) the guard reads. */
export interface AuthContext {
  uid: string;
  token: {
    email?: unknown;
    email_verified?: unknown;
    auth_time?: unknown;
    firebase?: { sign_in_provider?: unknown } | undefined;
    [claim: string]: unknown;
  };
}

export interface GuardConfig {
  /** Normalized (trimmed, lower-cased) admin emails. Empty = every admin call is refused (fail closed). */
  allowedEmails: readonly string[];
}

export interface Actor {
  uid: string;
  /** Normalized email (also the allowlist key). */
  email: string;
  /** Seconds since epoch when the user last actually signed in (ID token `auth_time`). */
  authTime: number;
}

/** Trim + lower-case. Every comparison against the allowlist goes through this. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** True when `email` (any case/whitespace) is in the normalized allowlist. */
export function isAllowlisted(email: string | null | undefined, allowedEmails: readonly string[]): boolean {
  if (typeof email !== "string") return false;
  const normalized = normalizeEmail(email);
  return normalized !== "" && allowedEmails.includes(normalized);
}

const denied = () => new AdminError("permission-denied", "Not authorized.");

/**
 * Stage 1, pure and I/O free: a verified email, a Google sign-in, and that email in the allowlist.
 * Runs before anything else so non-admins cost nothing. Any `admin` custom claim is ignored.
 */
export function requireAdmin(auth: AuthContext | undefined | null, config: GuardConfig): Actor {
  if (!auth || typeof auth.uid !== "string" || !auth.token) {
    throw new AdminError("unauthenticated", "Sign in required.");
  }
  const { token } = auth;
  if (token.email_verified !== true || typeof token.email !== "string" || normalizeEmail(token.email) === "") {
    throw denied();
  }
  if (token.firebase?.sign_in_provider !== "google.com") throw denied();
  if (config.allowedEmails.length === 0) {
    // Fail closed: a deploy without the secret must not hand admin powers to anyone.
    throw new AdminError("permission-denied", "Admin access is not configured.", "allowlist-not-configured");
  }
  const email = normalizeEmail(token.email);
  if (!config.allowedEmails.includes(email)) throw denied();
  const authTime = typeof token.auth_time === "number" && Number.isFinite(token.auth_time) ? token.auth_time : 0;
  return { uid: auth.uid, email, authTime };
}

/**
 * Stage 2, against the live Auth record: ID tokens stay valid for up to an hour after an account
 * is disabled, has its sessions revoked or changes email. Re-reading the account on every call
 * closes that window (what `verifyIdToken(token, true)` would do, plus the email checks).
 */
export function assertLiveAdmin(actor: Actor, live: AuthUser | null, config: GuardConfig): void {
  if (!live || live.uid !== actor.uid || live.disabled) throw denied();
  if (!live.emailVerified || normalizeEmail(live.email ?? "") !== actor.email) throw denied();
  if (!isAllowlisted(live.email, config.allowedEmails)) throw denied();
  if (live.tokensValidAfter) {
    const validAfterMs = Date.parse(live.tokensValidAfter);
    // Require tokensValidAfterTime <= auth_time.
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

/** Admin accounts (email in the allowlist) can't be disabled or deleted from the panel. */
export function refuseAdminTarget(target: AuthUser, config: GuardConfig, what: string): void {
  if (isAllowlisted(target.email, config.allowedEmails)) {
    throw new AdminError(
      "failed-precondition",
      `Admins can't be ${what}. Remove the email from ADMIN_ALLOWED_EMAILS and redeploy first.`,
      "target-is-admin",
    );
  }
}

/** Parses `ADMIN_ALLOWED_EMAILS` (comma or whitespace separated) into normalized, unique emails. */
export function parseEmailList(raw: string | undefined): string[] {
  if (!raw) return [];
  const emails = raw
    .split(/[\s,]+/)
    .map(normalizeEmail)
    .filter((e) => e.length > 0);
  return [...new Set(emails)];
}
