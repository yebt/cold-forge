import { AdminError } from "../errors.ts";
import type { AuthContext } from "../guard.ts";
import type { AuditEntry, AuditRecord, AuthPort, AuthUser, DataPort, ProfileView, UserCounts } from "../ports.ts";
import { consumeWindow, type WindowState } from "../rateLimit.ts";

/** In-memory Auth + Firestore fakes for service tests. */

export const NOW = new Date("2026-10-01T12:00:00.000Z");
export const nowSec = Math.floor(NOW.getTime() / 1000);

export function user(uid: string, patch: Partial<AuthUser> = {}): AuthUser {
  return {
    uid,
    email: `${uid.toLowerCase()}@example.com`,
    emailVerified: true,
    displayName: `User ${uid}`,
    photoURL: null,
    disabled: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastSignIn: "2026-09-30T00:00:00.000Z",
    lastRefresh: null,
    providers: ["google.com"],
    admin: false,
    tokensValidAfter: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

export function adminCtx(u: AuthUser, tokenPatch: Partial<AuthContext["token"]> = {}): AuthContext {
  return {
    uid: u.uid,
    token: {
      admin: true,
      email: u.email ?? undefined,
      email_verified: true,
      auth_time: nowSec - 60,
      firebase: { sign_in_provider: "google.com" },
      ...tokenPatch,
    },
  };
}

export class FakeAuth implements AuthPort {
  users = new Map<string, AuthUser>();
  calls: string[] = [];
  /** Hook to simulate concurrent changes inside setAdminClaim. */
  onSetAdminClaim: ((uid: string, admin: boolean) => void) | null = null;

  constructor(users: AuthUser[]) {
    for (const u of users) this.users.set(u.uid, u);
  }

  async getUser(uid: string) {
    const u = this.users.get(uid);
    return u ? { ...u } : null;
  }
  async getUserByEmail(email: string) {
    for (const u of this.users.values()) if (u.email?.toLowerCase() === email.toLowerCase()) return { ...u };
    return null;
  }
  async listUsers(maxResults: number, pageToken: string | null) {
    const all = [...this.users.values()].sort((a, b) => a.uid.localeCompare(b.uid));
    let start = 0;
    if (pageToken) {
      if (!/^p\d+$/.test(pageToken)) throw new AdminError("invalid-argument", "Invalid pageToken.");
      start = Number(pageToken.slice(1));
    }
    const users = all.slice(start, start + maxResults).map((u) => ({ ...u }));
    const end = start + users.length;
    return { users, nextPageToken: end < all.length ? `p${end}` : null };
  }
  private patch(uid: string, patch: Partial<AuthUser>) {
    const u = this.users.get(uid);
    if (!u) throw new Error("auth/user-not-found");
    this.users.set(uid, { ...u, ...patch });
  }
  async setDisabled(uid: string, disabled: boolean) {
    this.calls.push(`setDisabled:${uid}:${disabled}`);
    this.patch(uid, { disabled });
  }
  async revokeRefreshTokens(uid: string) {
    this.calls.push(`revoke:${uid}`);
    this.patch(uid, { tokensValidAfter: NOW.toISOString() });
  }
  async setAdminClaim(uid: string, admin: boolean) {
    this.calls.push(`setAdmin:${uid}:${admin}`);
    this.patch(uid, { admin });
    this.onSetAdminClaim?.(uid, admin);
  }
  async deleteUser(uid: string) {
    this.calls.push(`deleteUser:${uid}`);
    this.users.delete(uid);
  }
}

export class FakeData implements DataPort {
  counts = new Map<string, UserCounts>();
  profiles = new Map<string, ProfileView>();
  audit: AuditEntry[] = [];
  rate = new Map<string, WindowState>();
  calls: string[] = [];
  failDeleteData = false;

  async countUserData(uid: string) {
    return this.counts.get(uid) ?? { arcs: 0, habits: 0, checkIns: 0 };
  }
  async getProfile(uid: string) {
    return this.profiles.get(uid) ?? null;
  }
  async deleteUserData(uid: string) {
    this.calls.push(`deleteData:${uid}`);
    if (this.failDeleteData) throw new Error("boom");
    this.counts.delete(uid);
    this.profiles.delete(uid);
  }
  async countProfilesUpdatedSince(sinceIso: string) {
    return [...this.profiles.values()].filter((p) => (p.updatedAt ?? "") >= sinceIso).length;
  }
  async countAllData() {
    const t = { arcs: 0, habits: 0, checkIns: 0 };
    for (const c of this.counts.values()) {
      t.arcs += c.arcs;
      t.habits += c.habits;
      t.checkIns += c.checkIns;
    }
    return t;
  }
  async writeAudit(record: AuditRecord) {
    const id = `a${String(this.audit.length).padStart(19, "0")}`;
    this.audit.unshift({ ...record, id, at: NOW.toISOString() });
  }
  async listAudit(pageSize: number, afterId: string | null) {
    let start = 0;
    if (afterId) {
      const i = this.audit.findIndex((e) => e.id === afterId);
      if (i < 0) throw new AdminError("invalid-argument", "Invalid pageToken.");
      start = i + 1;
    }
    const entries = this.audit.slice(start, start + pageSize);
    const more = this.audit.length > start + pageSize;
    return { entries, nextPageToken: more ? (entries[entries.length - 1]?.id ?? null) : null };
  }
  async consumeRateLimit(key: string, rule: { limit: number; windowMs: number }, now: Date) {
    const { allowed, next } = consumeWindow(this.rate.get(key) ?? null, rule, now.getTime());
    this.rate.set(key, next);
    return allowed;
  }
}
