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
import { maskEmail } from "./crypto.ts";
import {
  applyCors,
  applySecurityHeaders,
  bearerToken,
  clientIp,
  errorResponse,
  HttpError,
  json,
  preflight,
  readJson,
  requireJsonContentType,
} from "./http.ts";
import type { Mailer } from "./mailer.ts";
import { MemoryRateLimiter, RATE_LIMITS, type RateLimiter, type Rule } from "./rate-limit.ts";
import { DEFAULT_PAGE_SIZE, DEFAULT_QUOTAS, SyncError, SyncService, type Quotas } from "./sync.ts";

export interface AppDeps {
  db: Database;
  mailer: Mailer;
  config: Config;
  clock?: Clock;
  limiter?: RateLimiter;
  quotas?: Quotas;
  pageSize?: number;
  /** Server-side log sink. Must never receive tokens, codes or full emails. */
  log?: (message: string, error?: unknown) => void;
}

/** The part of Bun's `Server` the app needs (structural, so tests can fake it). */
export interface ServerLike {
  requestIP(req: Request): { address: string } | null;
}

interface Ctx {
  req: Request;
  ip: string;
  auth: AuthContext | null;
}

type Method = "GET" | "POST" | "DELETE";
interface Route {
  auth: boolean;
  handle: (ctx: Ctx) => Promise<Response> | Response;
}

export function createApp(deps: AppDeps) {
  const { db, mailer, config } = deps;
  const now: Clock = deps.clock ?? Date.now;
  const limiter = deps.limiter ?? new MemoryRateLimiter(now);
  const log = deps.log ?? ((message: string, error?: unknown) => console.error(message, error ?? ""));
  const auth = new AuthService(db, config.authSecret, now);
  const sync = new SyncService(db, now, deps.quotas ?? DEFAULT_QUOTAS, deps.pageSize ?? DEFAULT_PAGE_SIZE);
  const production = config.env === "production";

  const limit = async (key: string, rules: readonly Rule[]) => {
    if (!(await limiter.take(key, rules))) throw new HttpError(429, "rate_limited", { "Retry-After": "60" });
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
          await limit(`magic-ip:${ip}`, RATE_LIMITS.magicLinkIp);
          const parsed = parseMagicLinkRequest(await readJson(req));
          if (!parsed.ok) throw new HttpError(400, "invalid_email");
          const { email, locale } = parsed.value;

          // Over the per-email limit: answer exactly like a success, but send nothing.
          // The response never depends on whether an account exists (accounts are created on verify).
          if (!(await limiter.take(`magic-email:${email}`, RATE_LIMITS.magicLinkEmail))) {
            return json({ requestId: crypto.randomUUID() }, 202);
          }
          const login = auth.issueLogin(email);
          const link = `${config.appUrl}/#/auth?token=${encodeURIComponent(login.token)}`;
          // Not awaited: SMTP latency must not make responses distinguishable.
          mailer
            .sendLoginEmail({ to: email, locale, code: login.code, link, expiresInMinutes: LOGIN_TTL_MS / 60_000 })
            .catch((e) => log(`login email to ${maskEmail(email)} failed`, e));
          return json({ requestId: login.requestId }, 202);
        },
      },
    },

    "/v1/auth/verify": {
      POST: {
        auth: false,
        async handle({ req, ip }) {
          await limit(`verify-ip:${ip}`, RATE_LIMITS.verifyIp);
          const parsed = parseVerifyRequest(await readJson(req));
          const session = parsed.ok ? auth.verify(parsed.value) : null;
          if (!session) throw new HttpError(400, "invalid_or_expired");
          return json(session);
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
          auth.deleteUser(user(ctx).user);
          return new Response(null, { status: 204 });
        },
      },
    },

    "/v1/sync": {
      POST: {
        auth: true,
        async handle(ctx) {
          const parsed = parseSyncRequest(await readJson(ctx.req), now());
          if (!parsed.ok) return json({ error: "invalid_request", detail: parsed.error }, 400);
          return json(sync.sync(user(ctx).user.id, parsed.value));
        },
      },
    },

    "/v1/export": {
      GET: {
        auth: true,
        handle(ctx) {
          const { user: u } = user(ctx);
          return json({ exportedAt: new Date(now()).toISOString(), user: u, ...sync.export(u.id) });
        },
      },
    },
  };

  async function handle(req: Request, server: ServerLike): Promise<Response> {
    const { pathname } = new URL(req.url);
    const ip = clientIp(server.requestIP(req)?.address, req.headers.get("X-Forwarded-For"), config.trustProxyHops);
    await limit(`ip:${ip}`, RATE_LIMITS.ipGlobal);

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
      await limit(`user:${ctxAuth.user.id}`, RATE_LIMITS.user);
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
    // Unexpected: log server-side (method + path only, never the body), answer generically.
    log(`unhandled error on ${req.method} ${new URL(req.url).pathname}`, e);
    return errorResponse(500, "internal_error");
  }

  return {
    /** Bun.serve options. */
    serve: {
      maxRequestBodySize: LIMITS.maxBodyBytes,
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
        log("server error", e);
        const res = errorResponse(500, "internal_error");
        applySecurityHeaders(res.headers, production);
        return res;
      },
    },
    /** Deletes expired login requests/sessions and stale rate-limit buckets. Run on start and on an interval. */
    cleanup(): number {
      limiter.sweep();
      return auth.cleanup();
    },
    auth,
    sync,
  };
}

export type App = ReturnType<typeof createApp>;
