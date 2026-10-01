/**
 * Passwordless login (email code + magic link) and opaque bearer sessions.
 *
 * Login request: a uniform 6-digit code and a 256-bit link token, stored only as
 * HMAC-SHA256(AUTH_SECRET, …). One row per request; consuming it by code OR token deletes the row,
 * so both die together. Five wrong codes delete it too. A new request for the same email deletes
 * the older pending ones.
 *
 * Session: a 256-bit opaque token, stored only as its HMAC. 60-day expiry, slid forward at most once
 * a day. Revocation deletes the row, so it takes effect on the very next request.
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
export const SESSION_TTL_MS = 60 * DAY;
export const SESSION_RENEW_AFTER_MS = DAY;

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
  expires_at: number;
  last_used_at: number;
}

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
      // Only the newest request for an email is valid.
      this.db.query("DELETE FROM login_requests WHERE email = ?").run(email);
      this.db
        .query(
          `INSERT INTO login_requests (id, email, code_hash, token_hash, attempts, created_at, expires_at)
           VALUES (?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(requestId, email, this.codeHash(requestId, code), keyedHash(this.secret, "login-token", token), now, expiresAt);
    }).immediate();
    return { requestId, code, token, expiresAt };
  }

  /** Consumes a login request. Returns a new session, or null for ANY failure (one generic error). */
  verify(input: VerifyRequest): SessionResponse | null {
    return this.db.transaction((): SessionResponse | null => {
      const now = this.now();
      let row: LoginRow | null;

      if ("token" in input) {
        if (!isTokenShape(input.token)) return null;
        const hash = keyedHash(this.secret, "login-token", input.token);
        row = this.db.query("SELECT * FROM login_requests WHERE token_hash = ?").get(hash) as LoginRow | null;
        if (!row || !safeEqual(row.token_hash, hash)) return null;
        if (row.expires_at <= now) return this.dropLogin(row.id);
      } else {
        row = this.db.query("SELECT * FROM login_requests WHERE id = ?").get(input.requestId) as LoginRow | null;
        if (!row) return null;
        if (row.expires_at <= now || row.attempts >= MAX_CODE_ATTEMPTS) return this.dropLogin(row.id);
        if (!safeEqual(row.code_hash, this.codeHash(row.id, input.code))) {
          const attempts = row.attempts + 1;
          if (attempts >= MAX_CODE_ATTEMPTS) this.dropLogin(row.id);
          else this.db.query("UPDATE login_requests SET attempts = ? WHERE id = ?").run(attempts, row.id);
          return null;
        }
      }

      // Single use: deleting the row kills both the code and the link.
      this.dropLogin(row.id);
      const user = this.findOrCreateUser(row.email);
      return this.createSession(user);
    }).immediate();
  }

  findOrCreateUser(email: string): AuthUser {
    this.db
      .query("INSERT INTO users (id, email, created_at, seq) VALUES (?, ?, ?, 0) ON CONFLICT (email) DO NOTHING")
      .run(crypto.randomUUID(), email, this.now());
    return this.db.query("SELECT id, email FROM users WHERE email = ?").get(email) as AuthUser;
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

  /** Resolves a bearer token to its user, sliding the expiry at most once a day. */
  authenticate(token: string): AuthContext | null {
    if (!isTokenShape(token)) return null;
    const now = this.now();
    const hash = keyedHash(this.secret, "session", token);
    const row = this.db
      .query(
        `SELECT s.user_id, s.expires_at, s.last_used_at, u.email
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`,
      )
      .get(hash) as SessionRow | null;
    if (!row) return null;
    if (row.expires_at <= now) {
      this.db.query("DELETE FROM sessions WHERE token_hash = ?").run(hash);
      return null;
    }
    if (now - row.last_used_at >= SESSION_RENEW_AFTER_MS) {
      this.db
        .query("UPDATE sessions SET expires_at = ?, last_used_at = ? WHERE token_hash = ?")
        .run(now + SESSION_TTL_MS, now, hash);
    }
    return { user: { id: row.user_id, email: row.email }, sessionHash: hash };
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
      this.db.query("DELETE FROM users WHERE id = ?").run(user.id);
    }).immediate();
  }

  /** Removes expired login requests and sessions. Returns how many rows were deleted. */
  cleanup(): number {
    const now = this.now();
    const a = this.db.query("DELETE FROM login_requests WHERE expires_at <= ?").run(now).changes;
    const b = this.db.query("DELETE FROM sessions WHERE expires_at <= ?").run(now).changes;
    return a + b;
  }

  private codeHash(requestId: string, code: string): Buffer {
    // Binding the request id means the same code in two requests yields different digests.
    return keyedHash(this.secret, "login-code", `${requestId}:${code}`);
  }

  private dropLogin(id: string): null {
    this.db.query("DELETE FROM login_requests WHERE id = ?").run(id);
    return null;
  }
}
