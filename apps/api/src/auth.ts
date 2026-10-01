/**
 * Passwordless login (email code + magic link) and opaque bearer sessions.
 *
 * Login request: a uniform 6-digit code and a 256-bit link token, stored only as
 * HMAC-SHA256(AUTH_SECRET, …). One row per request. Up to MAX_PENDING_PER_EMAIL requests per
 * email stay valid at once (a new one evicts only the oldest beyond that), so a stranger asking
 * for codes for your email cannot invalidate the one you are typing. Each request has its own
 * 5-attempt cap, 15-minute TTL and is single use (code OR link). A successful sign-in consumes
 * EVERY pending request for that email.
 *
 * Online guessing across requests: wrong codes are also counted per email (MAX_FAILED_CODES_PER_EMAIL
 * per 24 h, in the database). Over that, every code verify for the email fails until 24 h pass or
 * the owner signs in with the emailed link (256-bit tokens are not guessable, so links still work).
 *
 * Session: a 256-bit opaque token, stored only as its HMAC. 60-day expiry, slid forward at most once
 * a day, with an absolute lifetime of 1 year from creation. Revocation deletes the row, so it takes
 * effect on the very next request.
 *
 * Google sign-in seam: a future `signInWithGoogle(idToken)` verifies the ID token, then calls
 * `findOrCreateUser(email)` + `createSession(userId)` exactly like `verify()` does below.
 */
import type { Database } from "bun:sqlite";
import type { AuthUser, SessionResponse, VerifyRequest } from "@cold-forge/sync";
import type { Clock } from "./config.ts";
import { isTokenShape, keyedHash, randomCode, randomToken, safeEqual } from "./crypto.ts";
import { DAY, MINUTE } from "./rate-limit.ts";

export const LOGIN_TTL_MS = 15 * MINUTE;
export const MAX_CODE_ATTEMPTS = 5;
export const MAX_PENDING_PER_EMAIL = 3;
export const MAX_FAILED_CODES_PER_EMAIL = 10;
export const FAILED_CODES_WINDOW_MS = DAY;
export const SESSION_TTL_MS = 60 * DAY;
export const SESSION_RENEW_AFTER_MS = DAY;
/** Hard cap regardless of sliding renewal. */
export const SESSION_MAX_AGE_MS = 365 * DAY;
/** Sensitive operations (account deletion) need a session younger than this. */
export const RECENT_SIGN_IN_MS = 10 * MINUTE;

export interface IssuedLogin {
  requestId: string;
  code: string;
  token: string;
  expiresAt: number;
}

export interface AuthContext {
  user: AuthUser;
  /** Digest of the presented bearer token: identifies the current session for logout. */
  sessionHash: Buffer;
  /** When this session was created (= when the user last proved control of the mailbox). */
  sessionCreatedAt: number;
}

export type VerifyResult =
  | { ok: true; session: SessionResponse; createdUser: boolean }
  /** `invalid`: any failure (one generic error). `new_account_limit`: valid, but this IP may not create more accounts; nothing was consumed. */
  | { ok: false; reason: "invalid" | "new_account_limit" };

export interface VerifyOptions {
  /** False when the caller's IP has used up its new-account budget. Existing users are unaffected. */
  allowNewAccount?: boolean;
}

interface LoginRow {
  id: string;
  email: string;
  code_hash: Uint8Array;
  token_hash: Uint8Array;
  attempts: number;
  expires_at: number;
}

interface SessionRow {
  user_id: string;
  email: string;
  created_at: number;
  expires_at: number;
  last_used_at: number;
}

const INVALID = { ok: false, reason: "invalid" } as const;

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly secret: Buffer,
    private readonly now: Clock,
  ) {}

  /** Creates a login request for an already-validated, normalized email. Does NOT create a user. */
  issueLogin(email: string): IssuedLogin {
    const now = this.now();
    const requestId = crypto.randomUUID();
    const code = randomCode();
    const token = randomToken();
    const expiresAt = now + LOGIN_TTL_MS;
    this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO login_requests (id, email, code_hash, token_hash, attempts, created_at, expires_at)
           VALUES (?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(requestId, email, this.codeHash(requestId, code), keyedHash(this.secret, "login-token", token), now, expiresAt);
      // Keep the newest MAX_PENDING_PER_EMAIL live requests; drop expired ones and anything older.
      // rowid grows with every insert, so it orders requests even within the same millisecond.
      this.db
        .query(
          `DELETE FROM login_requests WHERE email = $email AND (expires_at <= $now OR rowid NOT IN (
             SELECT rowid FROM login_requests WHERE email = $email AND expires_at > $now ORDER BY rowid DESC LIMIT $keep))`,
        )
        .run({ email, now, keep: MAX_PENDING_PER_EMAIL });
    }).immediate();
    return { requestId, code, token, expiresAt };
  }

  /** Consumes a login request. Every failure is the same generic `invalid` (no oracle). */
  verify(input: VerifyRequest, opts: VerifyOptions = {}): VerifyResult {
    const allowNewAccount = opts.allowNewAccount ?? true;
    return this.db.transaction((): VerifyResult => {
      const now = this.now();
      let row: LoginRow | null;

      if ("token" in input) {
        if (!isTokenShape(input.token)) return INVALID;
        const hash = keyedHash(this.secret, "login-token", input.token);
        row = this.db.query("SELECT * FROM login_requests WHERE token_hash = ?").get(hash) as LoginRow | null;
        if (!row || !safeEqual(row.token_hash, hash)) return INVALID;
        if (row.expires_at <= now) return this.dropLogin(row.id);
      } else {
        row = this.db.query("SELECT * FROM login_requests WHERE id = ?").get(input.requestId) as LoginRow | null;
        if (!row) return INVALID;
        if (row.expires_at <= now || row.attempts >= MAX_CODE_ATTEMPTS) return this.dropLogin(row.id);
        // Per-email guessing cap: once reached, codes are not even compared.
        if (this.codesLocked(row.email, now)) return INVALID;
        if (!safeEqual(row.code_hash, this.codeHash(row.id, input.code))) {
          this.recordCodeFailure(row.email, now);
          const attempts = row.attempts + 1;
          if (attempts >= MAX_CODE_ATTEMPTS) this.dropLogin(row.id);
          else this.db.query("UPDATE login_requests SET attempts = ? WHERE id = ?").run(attempts, row.id);
          return INVALID;
        }
      }

      const existing = this.findUser(row.email);
      if (!existing && !allowNewAccount) return { ok: false, reason: "new_account_limit" };

      // Single use, and the mailbox owner is now proven: every pending request for the email dies,
      // and the per-email failed-code counter is cleared.
      this.db.query("DELETE FROM login_requests WHERE email = ?").run(row.email);
      this.db.query("DELETE FROM verify_failures WHERE email = ?").run(row.email);
      const user = existing ?? this.findOrCreateUser(row.email);
      return { ok: true, session: this.createSession(user), createdUser: !existing };
    }).immediate();
  }

  findUser(email: string): AuthUser | null {
    return this.db.query("SELECT id, email FROM users WHERE email = ?").get(email) as AuthUser | null;
  }

  findOrCreateUser(email: string): AuthUser {
    this.db
      .query("INSERT INTO users (id, email, created_at, seq) VALUES (?, ?, ?, 0) ON CONFLICT (email) DO NOTHING")
      .run(crypto.randomUUID(), email, this.now());
    return this.findUser(email)!;
  }

  createSession(user: AuthUser): SessionResponse {
    const now = this.now();
    const token = randomToken();
    const expiresAt = now + SESSION_TTL_MS;
    this.db
      .query("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?)")
      .run(keyedHash(this.secret, "session", token), user.id, now, expiresAt, now);
    return { token, expiresAt: new Date(expiresAt).toISOString(), user: { id: user.id, email: user.email } };
  }

  /** Resolves a bearer token to its user, sliding the expiry at most once a day (never past 1 year). */
  authenticate(token: string): AuthContext | null {
    if (!isTokenShape(token)) return null;
    const now = this.now();
    const hash = keyedHash(this.secret, "session", token);
    const row = this.db
      .query(
        `SELECT s.user_id, s.created_at, s.expires_at, s.last_used_at, u.email
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`,
      )
      .get(hash) as SessionRow | null;
    if (!row) return null;
    const hardExpiry = row.created_at + SESSION_MAX_AGE_MS;
    if (row.expires_at <= now || hardExpiry <= now) {
      this.db.query("DELETE FROM sessions WHERE token_hash = ?").run(hash);
      return null;
    }
    if (now - row.last_used_at >= SESSION_RENEW_AFTER_MS) {
      this.db
        .query("UPDATE sessions SET expires_at = ?, last_used_at = ? WHERE token_hash = ?")
        .run(Math.min(now + SESSION_TTL_MS, hardExpiry), now, hash);
    }
    return { user: { id: row.user_id, email: row.email }, sessionHash: hash, sessionCreatedAt: row.created_at };
  }

  /** True if this session was created recently enough for a sensitive operation. */
  isRecentSignIn(ctx: AuthContext): boolean {
    return this.now() - ctx.sessionCreatedAt <= RECENT_SIGN_IN_MS;
  }

  revokeSession(ctx: AuthContext): void {
    this.db.query("DELETE FROM sessions WHERE token_hash = ? AND user_id = ?").run(ctx.sessionHash, ctx.user.id);
  }

  revokeAllSessions(userId: string): void {
    this.db.query("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }

  /** Hard-deletes the account and everything that belongs to it. Explicit, not just ON DELETE CASCADE. */
  deleteUser(user: AuthUser): void {
    this.db.transaction(() => {
      for (const table of ["check_ins", "habits", "arcs", "profiles", "sessions"] as const) {
        // Table names come from the constant list above, never from input.
        this.db.query(`DELETE FROM ${table} WHERE user_id = ?`).run(user.id);
      }
      this.db.query("DELETE FROM login_requests WHERE email = ?").run(user.email);
      this.db.query("DELETE FROM verify_failures WHERE email = ?").run(user.email);
      this.db.query("DELETE FROM users WHERE id = ?").run(user.id);
    }).immediate();
    // secure_delete zeroes freed pages in the main file; also flush and truncate the WAL so the
    // deleted rows do not linger in it.
    this.db.query("PRAGMA wal_checkpoint(TRUNCATE)").get();
  }

  /** Removes expired login requests, sessions and failed-code windows. Returns how many rows were deleted. */
  cleanup(): number {
    const now = this.now();
    const a = this.db.query("DELETE FROM login_requests WHERE expires_at <= ?").run(now).changes;
    const b = this.db
      .query("DELETE FROM sessions WHERE expires_at <= ? OR created_at <= ?")
      .run(now, now - SESSION_MAX_AGE_MS).changes;
    this.db.query("DELETE FROM verify_failures WHERE window_start <= ?").run(now - FAILED_CODES_WINDOW_MS);
    return a + b;
  }

  private codesLocked(email: string, now: number): boolean {
    const r = this.db.query("SELECT failures, window_start FROM verify_failures WHERE email = ?").get(email) as {
      failures: number;
      window_start: number;
    } | null;
    return !!r && now - r.window_start < FAILED_CODES_WINDOW_MS && r.failures >= MAX_FAILED_CODES_PER_EMAIL;
  }

  private recordCodeFailure(email: string, now: number): void {
    this.db
      .query(
        `INSERT INTO verify_failures (email, failures, window_start) VALUES ($email, 1, $now)
         ON CONFLICT (email) DO UPDATE SET
           failures = CASE WHEN $now - window_start >= $window THEN 1 ELSE failures + 1 END,
           window_start = CASE WHEN $now - window_start >= $window THEN $now ELSE window_start END`,
      )
      .run({ email, now, window: FAILED_CODES_WINDOW_MS });
  }

  private codeHash(requestId: string, code: string): Buffer {
    // Binding the request id means the same code in two requests yields different digests.
    return keyedHash(this.secret, "login-code", `${requestId}:${code}`);
  }

  private dropLogin(id: string): typeof INVALID {
    this.db.query("DELETE FROM login_requests WHERE id = ?").run(id);
    return INVALID;
  }
}
