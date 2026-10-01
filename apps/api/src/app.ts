/**
 * The HTTP application. `createApp(deps)` returns options for `Bun.serve` with every dependency
 * injected (database, mailer, clock, config, rate limiter), so tests run it on port 0 with an
 * in-memory database, a fake mailer and a fake clock.
 *
 * Every response — success, error, 404, preflight — goes through `finalize()`, which adds the
 * security headers and CORS headers. Every error is a generic `{ error: code }`; details stay in
 * the server log.
 */
import type { Database } from "bun:sqlite";
import { LIMITS, parseMagicLinkRequest, parseSyncRequest, parseVerifyRequest } from "@cold-forge/sync";
import { AuthService, LOGIN_TTL_MS, type AuthContext } from "./auth.ts";
import type { Clock, Config } from "./config.ts";
import {
  applyCors,
  applySecurityHeaders,
  bearerToken,
  clientIp,
  errorResponse,
  ipRateKey,
  HttpError,
  json,
  preflight,
  readJson,
  requireJsonContentType,
} from "./http.ts";
import { mailErrorSummary, type Mailer } from "./mailer.ts";
import { createMemoryLimiters, HOUR, RATE_LIMITS, type Limiters, type RateLimiter, type Rule } from "./rate-limit.ts";
import { DEFAULT_PAGE_SIZE, DEFAULT_QUOTAS, SyncError, SyncService, type Quotas } from "./sync.ts";

export interface AppDeps {
  db: Database;
  mailer: Mailer;
  config: Config;
  clock?: Clock;
  /** Rate limiter stores (default: in-memory, single instance). */
  limiters?: Limiters;
  quotas?: Quotas;
  pageSize?: number;
  /**
   * Server-side log sink. Receives only fixed messages plus non-identifying details (error class,
   * codes): never tokens, codes, emails, request bodies or raw error objects.
   */
  log?: (message: string) => void;
}

/** Bun's own body cap sits a little above ours so that, in the common case, readJson() produces the 413 (with our headers). */
export const BODY_SIZE_SLACK = 64 * 1024;

/** Error class + code only. Messages can carry data (SQL values, parser input), so production never logs them. */
export function describeError(e: unknown, production: boolean): string {
  if (!(e instanceof Error)) return typeof e;
  const code = (e as { code?: unknown }).code;
  const base = `${e.name}${typeof code === "string" ? ` (${code.slice(0, 40)})` : ""}`;
  return production ? base : `${base}: ${e.message}`;
}

/** The part of Bun's `Server` the app needs (structural, so tests can fake it). */
export interface ServerLike {
  requestIP(req: Request): { address: string } | null;
}

interface Ctx {
  req: Request;
  /** Rate-limit key for the client address (IPv4, or the IPv6 /64). */
  ip: string;
  auth: AuthContext | null;
}

type Method = "GET" | "POST" | "DELETE";
interface Route {
  auth: boolean;
  /** Extra per-user limits for this endpoint, on top of RATE_LIMITS.user. */
  userLimits?: readonly Rule[];
  handle: (ctx: Ctx) => Promise<Response> | Response;
}

export function createApp(deps: AppDeps) {
  const { db, mailer, config } = deps;
  const now: Clock = deps.clock ?? Date.now;
  const log = deps.log ?? ((message: string) => console.error(message));
  const production = config.env === "production";
  let lastFullWarning = 0;
  const limiters =
    deps.limiters ??
    createMemoryLimiters(now, (store) => {
      if (now() - lastFullWarning < 60_000) return;
      lastFullWarning = now();
      log(`rate limiter store "${store}" is full of live buckets`);
    });
  const auth = new AuthService(db, config.authSecret, now);
  const sync = new SyncService(db, now, deps.quotas ?? DEFAULT_QUOTAS, deps.pageSize ?? DEFAULT_PAGE_SIZE);
  const mailCapRule: Rule[] = [{ limit: config.mailHourlyCap, windowMs: HOUR }];
  let lastMailCapWarning = 0;

  const limit = async (store: RateLimiter, key: string, rules: readonly Rule[], cost = 1) => {
    if (!(await store.take(key, rules, cost))) throw new HttpError(429, "rate_limited", { "Retry-After": "60" });
  };
  const user = (ctx: Ctx) => ctx.auth!; // only called on `auth: true` routes

  const routes: Record<string, Partial<Record<Method, Route>>> = {
    "/v1/health": {
      GET: { auth: false, handle: () => json({ ok: true }) },
    },

    "/v1/auth/magic-link": {
      POST: {
        auth: false,
        async handle({ req, ip }) {
          await limit(limiters.auth, `magic-ip:${ip}`, RATE_LIMITS.magicLinkIp);
          const parsed = parseMagicLinkRequest(await readJson(req));
          if (!parsed.ok) throw new HttpError(400, "invalid_email");
          const { email, locale } = parsed.value;
          // Indistinguishable from a real request whether or not anything is sent.
          const silent = () => json({ requestId: crypto.randomUUID() }, 202);

          // Email-keyed limits: answer exactly like a success, but send nothing. The strict limit is
          // per (email, IP) so a stranger cannot spend the owner's budget; the shared per-email limit
          // is loose (cooldown + daily cap). All or nothing: a refused request charges no bucket.
          // The response never depends on whether an account exists (accounts are created on verify).
          // The global cap on outgoing login mail (sender reputation, SMTP quota) is part of the same take.
          const allowed = await limiters.auth.takeAll([
            { key: `magic-email-ip:${email}|${ip}`, rules: RATE_LIMITS.magicLinkEmailIp },
            { key: `magic-email:${email}`, rules: RATE_LIMITS.magicLinkEmail },
            { key: "mail-global", rules: mailCapRule },
          ]);
          if (!allowed) {
            if (!(await limiters.auth.check("mail-global", mailCapRule)) && now() - lastMailCapWarning >= 60_000) {
              lastMailCapWarning = now();
              log(`login email not sent: global cap of ${config.mailHourlyCap}/hour reached (MAIL_HOURLY_CAP)`);
            }
            return silent();
          }
          const login = auth.issueLogin(email);
          const link = `${config.appUrl}/#/auth?token=${encodeURIComponent(login.token)}`;
          // Not awaited: SMTP latency must not make responses distinguishable.
          mailer
            .sendLoginEmail({ to: email, locale, code: login.code, link, expiresInMinutes: LOGIN_TTL_MS / 60_000 })
            .catch((e) => log(`login email failed: ${mailErrorSummary(e)}`));
          return json({ requestId: login.requestId }, 202);
        },
      },
    },

    "/v1/auth/verify": {
      POST: {
        auth: false,
        async handle({ req, ip }) {
          await limit(limiters.auth, `verify-ip:${ip}`, RATE_LIMITS.verifyIp);
          const parsed = parseVerifyRequest(await readJson(req));
          if (!parsed.ok) throw new HttpError(400, "invalid_or_expired");
          const accountKey = `new-accounts:${ip}`;
          const allowNewAccount = await limiters.auth.check(accountKey, RATE_LIMITS.newAccountsIp);
          const result = auth.verify(parsed.value, { allowNewAccount });
          if (!result.ok) {
            if (result.reason === "new_account_limit") {
              throw new HttpError(429, "rate_limited", { "Retry-After": String(HOUR / 1000) });
            }
            throw new HttpError(400, "invalid_or_expired");
          }
          if (result.createdUser) await limiters.auth.take(accountKey, RATE_LIMITS.newAccountsIp);
          return json(result.session);
        },
      },
    },

    "/v1/auth/logout": {
      POST: {
        auth: true,
        handle(ctx) {
          auth.revokeSession(user(ctx));
          return new Response(null, { status: 204 });
        },
      },
    },

    "/v1/auth/logout-all": {
      POST: {
        auth: true,
        handle(ctx) {
          auth.revokeAllSessions(user(ctx).user.id);
          return new Response(null, { status: 204 });
        },
      },
    },

    "/v1/me": {
      GET: { auth: true, handle: (ctx) => json({ user: user(ctx).user }) },
      DELETE: {
        auth: true,
        handle(ctx) {
          // Irreversible: require a session created in the last few minutes (a fresh code/link).
          if (!auth.isRecentSignIn(user(ctx))) throw new HttpError(403, "reauth_required");
          auth.deleteUser(user(ctx).user);
          return new Response(null, { status: 204 });
        },
      },
    },

    "/v1/sync": {
      POST: {
        auth: true,
        userLimits: RATE_LIMITS.userSync,
        async handle(ctx) {
          const parsed = parseSyncRequest(await readJson(ctx.req), now());
          if (!parsed.ok) return json({ error: "invalid_request", detail: parsed.error }, 400);
          const id = user(ctx).user.id;
          // Cost-based: records submitted per user per minute.
          await limit(limiters.user, `writes:${id}`, RATE_LIMITS.userWrites, SyncService.cost(parsed.value));
          return json(sync.sync(id, parsed.value));
        },
      },
    },

    "/v1/export": {
      GET: {
        auth: true,
        userLimits: RATE_LIMITS.userExport,
        handle(ctx) {
          const { user: u } = user(ctx);
          return json({ exportedAt: new Date(now()).toISOString(), user: u, ...sync.export(u.id) });
        },
      },
    },
  };

  async function handle(req: Request, server: ServerLike): Promise<Response> {
    const { pathname } = new URL(req.url);
    const ip = ipRateKey(
      clientIp(server.requestIP(req)?.address, req.headers.get("X-Forwarded-For"), config.trustProxyHops),
    );
    await limit(limiters.general, `ip:${ip}`, RATE_LIMITS.ipGlobal);

    const route = Object.hasOwn(routes, pathname) ? routes[pathname]! : null;
    if (!route) return errorResponse(404, "not_found");
    if (req.method === "OPTIONS") return preflight(req, config.corsOrigins);

    // Browsers always send Origin on cross-origin requests. Refuse disallowed ones outright
    // instead of relying on the browser to hide the response. (Native apps/curl send none.)
    const origin = req.headers.get("Origin");
    if (origin !== null && !config.corsOrigins.has(origin)) return errorResponse(403, "origin_not_allowed");

    const endpoint = Object.hasOwn(route, req.method) ? route[req.method as Method] : undefined;
    if (!endpoint) {
      return errorResponse(405, "method_not_allowed", { Allow: [...Object.keys(route), "OPTIONS"].join(", ") });
    }
    if (req.method === "POST") requireJsonContentType(req);

    let ctxAuth: AuthContext | null = null;
    if (endpoint.auth) {
      const token = bearerToken(req);
      ctxAuth = token ? auth.authenticate(token) : null;
      if (!ctxAuth) throw new HttpError(401, "unauthorized", { "WWW-Authenticate": 'Bearer realm="cold-forge"' });
      const uid = ctxAuth.user.id;
      const ok = await limiters.user.takeAll([
        { key: `user:${uid}`, rules: RATE_LIMITS.user },
        ...(endpoint.userLimits ? [{ key: `user:${uid}:${req.method} ${pathname}`, rules: endpoint.userLimits }] : []),
      ]);
      if (!ok) throw new HttpError(429, "rate_limited", { "Retry-After": "60" });
    }
    return endpoint.handle({ req, ip, auth: ctxAuth });
  }

  function finalize(res: Response, req: Request): Response {
    applySecurityHeaders(res.headers, production);
    applyCors(res.headers, req.headers.get("Origin"), config.corsOrigins);
    return res;
  }

  function toErrorResponse(e: unknown, req: Request): Response {
    if (e instanceof HttpError) return errorResponse(e.status, e.code, e.headers);
    if (e instanceof SyncError) return errorResponse(e.status, e.code);
    // Unexpected: log server-side (method + path + error class only, never the body), answer generically.
    log(`unhandled error on ${req.method} ${new URL(req.url).pathname}: ${describeError(e, production)}`);
    return errorResponse(500, "internal_error");
  }

  return {
    /** Bun.serve options. */
    serve: {
      // Slightly above LIMITS.maxBodyBytes: requests between the two limits reach readJson(), which
      // answers 413 { error: "payload_too_large" } with our security/CORS headers. Only bodies over
      // the slack get Bun's bare 413 (no CORS headers, so a browser sees a network error instead).
      maxRequestBodySize: LIMITS.maxBodyBytes + BODY_SIZE_SLACK,
      async fetch(req: Request, server: ServerLike): Promise<Response> {
        let res: Response;
        try {
          res = await handle(req, server);
        } catch (e) {
          res = toErrorResponse(e, req);
        }
        return finalize(res, req);
      },
      error(e: Error): Response {
        log(`server error: ${describeError(e, production)}`);
        const res = errorResponse(500, "internal_error");
        applySecurityHeaders(res.headers, production);
        return res;
      },
    },
    /** Deletes expired login requests/sessions and stale rate-limit buckets. Run on start and on an interval. */
    cleanup(): number {
      limiters.general.sweep();
      limiters.auth.sweep();
      limiters.user.sweep();
      return auth.cleanup();
    },
    auth,
    sync,
  };
}

export type App = ReturnType<typeof createApp>;
