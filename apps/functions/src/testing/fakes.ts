import { AdminError } from "../errors.ts";
import type { AuthContext } from "../guard.ts";
import type { AuditEntry, AuditRecord, AuthPort, AuthUser, BlockReason, DataPort, ProfileView, UserCounts } from "../ports.ts";
import type { CountedKind, QuotaPort, QuotaRow } from "../quota.ts";
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

const RANK: Record<BlockReason, number> = { disabled: 1, quota: 2, deleted: 3 };

export class FakeData implements DataPort {
  /** blocked/{uid} */
  blocked = new Map<string, BlockReason>();
  counts = new Map<string, UserCounts>();
  profiles = new Map<string, ProfileView>();
  audit: AuditEntry[] = [];
  rate = new Map<string, WindowState>();
  calls: string[] = [];
  failDeleteData = false;

  async setBlocked(uid: string, reason: BlockReason) {
    this.calls.push(`block:${uid}:${reason}`);
    const cur = this.blocked.get(uid);
    if (!cur || RANK[reason] >= RANK[cur]) this.blocked.set(uid, reason);
  }
  async unblockDisabled(uid: string) {
    const cur = this.blocked.get(uid) ?? null;
    if (cur === "disabled") {
      this.calls.push(`unblock:${uid}`);
      this.blocked.delete(uid);
      return null;
    }
    return cur;
  }
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

/** In-memory quota/{uid} + blocked/{uid} + users/{uid} check-in counts for the quota jobs. */
export class FakeQuota implements QuotaPort {
  quota = new Map<string, { arcs: number; habits: number; checkIns: number | null; countedAt: number | null; updatedAt: number }>();
  blocked = new Map<string, { reason: BlockReason; sweepAfter: number | null }>();
  /** Live number of check-in docs per user (what count() would return). */
  checkInDocs = new Map<string, number>();
  users = new Set<string>();
  calls: string[] = [];
  now = NOW.getTime();

  private row(uid: string) {
    let r = this.quota.get(uid);
    if (!r) this.quota.set(uid, (r = { arcs: 0, habits: 0, checkIns: null, countedAt: null, updatedAt: 0 }));
    return r;
  }
  async increment(uid: string, kind: CountedKind, now: Date) {
    const r = this.row(uid);
    r[kind]++;
    r.updatedAt = now.getTime();
    return r[kind];
  }
  async setBlocked(uid: string, reason: BlockReason) {
    this.calls.push(`block:${uid}:${reason}`);
    const cur = this.blocked.get(uid);
    if (cur && RANK[cur.reason] > RANK[reason]) return;
    this.blocked.set(uid, { reason, sweepAfter: reason === "deleted" ? this.now + 3_600_000 : null });
  }
  async listActive(since: Date, limit: number): Promise<QuotaRow[]> {
    return [...this.quota]
      .filter(([, r]) => r.updatedAt >= since.getTime())
      .slice(0, limit)
      .map(([uid, r]) => ({ uid, checkIns: r.checkIns }));
  }
  async listStale(before: Date, limit: number): Promise<QuotaRow[]> {
    return [...this.quota]
      .filter(([, r]) => r.countedAt !== null && r.countedAt < before.getTime())
      .sort((a, b) => a[1].countedAt! - b[1].countedAt!)
      .slice(0, limit)
      .map(([uid, r]) => ({ uid, checkIns: r.checkIns }));
  }
  async countCheckIns(uid: string) {
    this.calls.push(`count:${uid}`);
    return this.checkInDocs.get(uid) ?? 0;
  }
  async saveCheckIns(uid: string, count: number, now: Date) {
    const r = this.row(uid);
    r.checkIns = count;
    r.countedAt = now.getTime();
  }
  async listDueSweeps(now: Date, limit: number) {
    return [...this.blocked]
      .filter(([, b]) => b.sweepAfter !== null && b.sweepAfter <= now.getTime())
      .slice(0, limit)
      .map(([uid]) => uid);
  }
  async deleteUserData(uid: string) {
    this.calls.push(`deleteData:${uid}`);
    this.users.delete(uid);
    this.checkInDocs.delete(uid);
  }
  async markSwept(uid: string) {
    const b = this.blocked.get(uid);
    if (b) b.sweepAfter = null;
  }
}
