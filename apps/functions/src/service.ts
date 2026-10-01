import type {
  AuditEntryDto,
  WhoAmIResponse,
  ListAuditResponse,
  ListUsersResponse,
  MutationResponse,
  StatsResponse,
  UserDetailResponse,
  UserRowDto,
} from "./api.ts";
import { AdminError, type AdminErrorReason } from "./errors.ts";
import {
  assertLiveAdmin,
  isAllowlisted,
  parseEmailList,
  refuseAdminTarget,
  refuseSelf,
  requireAdmin,
  requireRecentLogin,
  type Actor,
  type AuthContext,
  type GuardConfig,
} from "./guard.ts";
import type { AuditAction, AuthPort, AuthUser, DataPort, UserCounts } from "./ports.ts";
import { RATE_RULES, type RateBucket } from "./rateLimit.ts";
import {
  isUid,
  looksLikeEmail,
  MAX_PAGE_SIZE,
  parseDeleteUser,
  parseEmpty,
  parseListAudit,
  parseListUsers,
  parseSetDisabled,
  parseUidOnly,
} from "./validate.ts";

export interface ServiceConfig extends GuardConfig {
  /** Max age of the sign-in for delete. */
  recentLoginSeconds: number;
  /** Search scans at most this many Auth pages (1000 accounts each) per call. */
  searchScanPages: number;
  /** `adminStats` counts at most this many Auth pages. */
  statsScanPages: number;
  /** Parallel Firestore count() queries. */
  countConcurrency: number;
}

export const DEFAULT_SERVICE_CONFIG: ServiceConfig = {
  allowedEmails: [],
  recentLoginSeconds: 30 * 60,
  searchScanPages: 5,
  statsScanPages: 20,
  countConcurrency: 8,
};

export interface ServiceDeps {
  auth: AuthPort;
  data: DataPort;
  now?: () => Date;
  config?: Partial<ServiceConfig>;
}

const AUTH_PAGE = 1000;
const DAY_MS = 86_400_000;

/** Deliberate refusals that are written to the audit log (outcome "refused"). */
const AUDITED_REFUSALS = new Set<AdminErrorReason>([
  "self-action",
  "target-is-admin",
  "confirm-mismatch",
  "recent-login-required",
  "rate-limited",
]);

const rawUid = (raw: unknown): string =>
  typeof raw === "object" && raw !== null && isUid((raw as { uid?: unknown }).uid) ? (raw as { uid: string }).uid : "";

export function toUserRow(user: AuthUser, counts: UserCounts | null, allowedEmails: readonly string[]): UserRowDto {
  return {
    uid: user.uid,
    email: user.email,
    emailVerified: user.emailVerified,
    displayName: user.displayName,
    photoURL: user.photoURL && /^https:\/\//i.test(user.photoURL) ? user.photoURL : null,
    disabled: user.disabled,
    createdAt: user.createdAt,
    lastSignIn: user.lastSignIn,
    providers: user.providers,
    isAdmin: isAllowlisted(user.email, allowedEmails),
    counts,
  };
}

export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

function matches(user: AuthUser, q: string): boolean {
  return (
    (user.email ?? "").toLowerCase().includes(q) ||
    (user.displayName ?? "").toLowerCase().includes(q) ||
    user.uid.toLowerCase() === q
  );
}

/**
 * All admin use cases. Every public method takes the callable's `request.auth` and raw `data`,
 * authorizes, validates, then acts. Order matters: the pure token check runs first (non-admins
 * cost no I/O), then the rate limit, then the live account check.
 */
export function createAdminService(deps: ServiceDeps) {
  const { auth, data } = deps;
  const now = deps.now ?? (() => new Date());
  const merged: ServiceConfig = { ...DEFAULT_SERVICE_CONFIG, ...deps.config };
  // Normalize once (trim + lower-case), whatever the caller passed.
  const config: ServiceConfig = { ...merged, allowedEmails: parseEmailList(merged.allowedEmails.join(",")) };

  /**
   * `audited`: the action to record if this call is rate limited (mutations and user views; list
   * pages are not audited), with the target uid taken from the raw input when it is valid.
   */
  async function authorize(
    ctx: AuthContext | undefined | null,
    bucket: RateBucket,
    audited?: { action: AuditAction; raw: unknown },
  ): Promise<Actor> {
    const actor = requireAdmin(ctx, config);
    const allowed = await data.consumeRateLimit(`${actor.uid}_${bucket}`, RATE_RULES[bucket], now());
    if (!allowed) {
      const error = new AdminError("resource-exhausted", "Too many requests. Slow down.", "rate-limited");
      if (audited) await auditRefusal(actor, audited.action, rawUid(audited.raw), null, error);
      throw error;
    }
    assertLiveAdmin(actor, await auth.getUser(actor.uid), config);
    return actor;
  }

  /** Records a deliberate refusal (best effort: the refusal itself must still reach the caller). */
  async function auditRefusal(actor: Actor, action: AuditAction, targetUid: string, targetEmail: string | null, error: unknown) {
    if (!(error instanceof AdminError) || !error.reason || !AUDITED_REFUSALS.has(error.reason)) return;
    await data
      .writeAudit({ actorUid: actor.uid, actorEmail: actor.email, action, targetUid, targetEmail, reason: null, outcome: "refused", code: error.reason })
      .catch(() => undefined);
  }

  /** Runs the checks of a mutation; a refusal among them is audited, then rethrown. */
  async function checked<T>(actor: Actor, action: AuditAction, targetUid: string, target: () => AuthUser | null, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      await auditRefusal(actor, action, targetUid, target()?.email ?? null, error);
      throw error;
    }
  }

  async function requireTarget(uid: string): Promise<AuthUser> {
    const user = await auth.getUser(uid);
    if (!user) throw new AdminError("not-found", "User not found.");
    return user;
  }

  async function audit(actor: Actor, action: AuditAction, target: AuthUser, reason: string | null, outcome: "ok" | "error") {
    await data.writeAudit({
      actorUid: actor.uid,
      actorEmail: actor.email,
      action,
      targetUid: target.uid,
      targetEmail: target.email,
      reason,
      outcome,
      code: null,
    });
  }

  /** Runs a mutation; records failures too (best effort) so attempts are never invisible. */
  async function audited<T>(actor: Actor, action: AuditAction, target: AuthUser, reason: string | null, run: () => Promise<T>): Promise<T> {
    let result: T;
    try {
      result = await run();
    } catch (error) {
      await audit(actor, action, target, reason, "error").catch(() => undefined);
      throw error;
    }
    await audit(actor, action, target, reason, "ok");
    return result;
  }

  const row = (u: AuthUser, counts: UserCounts | null) => toUserRow(u, counts, config.allowedEmails);
  const withCounts = (users: AuthUser[]) =>
    mapLimit(users, config.countConcurrency, async (u) => row(u, await data.countUserData(u.uid)));

  return {
    /** Lets the panel ask "am I an admin?" with exactly the checks every other callable runs. */
    async whoAmI(ctx: AuthContext | undefined | null, raw: unknown): Promise<WhoAmIResponse> {
      const actor = await authorize(ctx, "read");
      parseEmpty(raw);
      return { email: actor.email, isAdmin: true };
    },

    async listUsers(ctx: AuthContext | undefined | null, raw: unknown): Promise<ListUsersResponse> {
      await authorize(ctx, "read");
      const input = parseListUsers(raw);

      if (input.query === null) {
        const page = await auth.listUsers(input.pageSize, input.pageToken);
        return { users: await withCounts(page.users), nextPageToken: page.nextPageToken, mode: "page", scanned: page.users.length, truncated: false };
      }

      const q = input.query;
      if (!input.pageToken) {
        const exact = looksLikeEmail(q) ? await auth.getUserByEmail(q) : isUid(q) && q.length >= 20 ? await auth.getUser(q) : null;
        if (exact) return { users: await withCounts([exact]), nextPageToken: null, mode: "exact", scanned: 1, truncated: false };
      }

      // Auth has no search API: scan whole pages and filter. Pages are never split, so the returned
      // token always points at the first unscanned account.
      const found: AuthUser[] = [];
      let token = input.pageToken;
      let scanned = 0;
      for (let i = 0; i < config.searchScanPages; i++) {
        const page = await auth.listUsers(AUTH_PAGE, token);
        scanned += page.users.length;
        found.push(...page.users.filter((u) => matches(u, q)));
        token = page.nextPageToken;
        if (!token || found.length >= input.pageSize) break;
      }
      const truncated = found.length > MAX_PAGE_SIZE;
      return { users: await withCounts(found.slice(0, MAX_PAGE_SIZE)), nextPageToken: token, mode: "search", scanned, truncated };
    },

    async getUser(ctx: AuthContext | undefined | null, raw: unknown): Promise<UserDetailResponse> {
      const actor = await authorize(ctx, "read", { action: "user.view", raw });
      const { uid } = parseUidOnly(raw);
      const user = await requireTarget(uid);
      const [counts, profile] = await Promise.all([data.countUserData(uid), data.getProfile(uid)]);
      // Sensitive read (one account's profile and activity): audited, coarsely. List pages are not.
      await audit(actor, "user.view", user, null, "ok");
      return { user: row(user, counts), profile, lastRefresh: user.lastRefresh };
    },

    async setDisabled(ctx: AuthContext | undefined | null, raw: unknown): Promise<MutationResponse> {
      const guess: AuditAction = typeof raw === "object" && raw !== null && (raw as { disabled?: unknown }).disabled === false ? "user.enable" : "user.disable";
      const actor = await authorize(ctx, "write", { action: guess, raw });
      const input = parseSetDisabled(raw);
      const action: AuditAction = input.disabled ? "user.disable" : "user.enable";
      let target: AuthUser | null = null;
      await checked(actor, action, input.uid, () => target, async () => {
        refuseSelf(actor, input.uid, input.disabled ? "disable" : "enable");
        target = await requireTarget(input.uid);
        if (input.disabled) refuseAdminTarget(target, config, "disabled");
      });
      const t = target as unknown as AuthUser;
      await audited(actor, action, t, input.reason, async () => {
        await auth.setDisabled(t.uid, input.disabled);
        if (input.disabled) {
          // Firestore access ends now (rules check blocked/{uid}), not when the ID token expires.
          await data.setBlocked(t.uid, "disabled");
          await auth.revokeRefreshTokens(t.uid);
        } else {
          // Lifts only an admin "disabled" block: a quota or deleted block stays.
          await data.unblockDisabled(t.uid);
        }
      });
      const updated = await auth.getUser(t.uid);
      return { ok: true, user: updated ? row(updated, null) : null };
    },

    async deleteUser(ctx: AuthContext | undefined | null, raw: unknown): Promise<MutationResponse> {
      const actor = await authorize(ctx, "write", { action: "user.delete", raw });
      const input = parseDeleteUser(raw);
      let found: AuthUser | null = null;
      await checked(actor, "user.delete", input.uid, () => found, async () => {
        refuseSelf(actor, input.uid, "delete");
        requireRecentLogin(actor, now(), config.recentLoginSeconds);
        found = await requireTarget(input.uid);
        refuseAdminTarget(found, config, "deleted");
        const expected = (found.email ?? found.uid).toLowerCase();
        if (input.confirm !== expected) {
          throw new AdminError("invalid-argument", "Confirmation does not match the account's email.", "confirm-mismatch");
        }
      });
      const target = found as unknown as AuthUser;
      await audited(actor, "user.delete", target, input.reason, async () => {
        // Lock the account first so no client can read or write while its data is being removed:
        // blocked/{uid} takes effect in the rules at once (the ID token stays valid up to an hour).
        await data.setBlocked(target.uid, "deleted");
        if (!target.disabled) await auth.setDisabled(target.uid, true);
        await auth.revokeRefreshTokens(target.uid);
        await data.deleteUserData(target.uid);
        await auth.deleteUser(target.uid);
      });
      return { ok: true, user: null };
    },

    async stats(ctx: AuthContext | undefined | null, raw: unknown): Promise<StatsResponse> {
      await authorize(ctx, "read");
      parseEmpty(raw);
      const at = now();
      const d7 = at.getTime() - 7 * DAY_MS;
      const d30 = at.getTime() - 30 * DAY_MS;

      let totalUsers = 0;
      let disabledUsers = 0;
      let admins = 0;
      let signups7d = 0;
      let signups30d = 0;
      let token: string | null = null;
      let pages = 0;
      do {
        const page = await auth.listUsers(AUTH_PAGE, token);
        pages++;
        for (const u of page.users) {
          totalUsers++;
          if (u.disabled) disabledUsers++;
          if (isAllowlisted(u.email, config.allowedEmails)) admins++;
          const created = u.createdAt ? Date.parse(u.createdAt) : NaN;
          if (created >= d7) signups7d++;
          if (created >= d30) signups30d++;
        }
        token = page.nextPageToken;
      } while (token && pages < config.statsScanPages);

      const [active7d, totals] = await Promise.all([
        data.countProfilesUpdatedSince(new Date(d7).toISOString()),
        data.countAllData(),
      ]);
      return {
        totalUsers,
        usersCapped: token !== null,
        disabledUsers,
        admins,
        signups7d,
        signups30d,
        active7d,
        totals,
        generatedAt: at.toISOString(),
      };
    },

    async listAuditLog(ctx: AuthContext | undefined | null, raw: unknown): Promise<ListAuditResponse> {
      await authorize(ctx, "read");
      const input = parseListAudit(raw);
      const page = await data.listAudit(input.pageSize, input.pageToken);
      const entries: AuditEntryDto[] = page.entries.map((e) => ({ ...e }));
      return { entries, nextPageToken: page.nextPageToken };
    },
  };
}

export type AdminService = ReturnType<typeof createAdminService>;
