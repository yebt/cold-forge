import type { Locale } from "@cold-forge/i18n";
import { isId, type SessionResponse, type SyncRequest, type VerifyRequest } from "@cold-forge/sync";
import { isSafeToken, parseSession, parseSyncPage, type SyncPage } from "./validate.ts";

export type ApiError =
  /** The base URL is not https (or localhost): nothing is sent. */
  | { kind: "insecure" }
  /** Offline, DNS, timeout, CORS… */
  | { kind: "network" }
  /** The session is gone (expired, revoked, account deleted). */
  | { kind: "unauthorized" }
  | { kind: "rate_limited"; retryAfterMs: number }
  /** Wrong/expired code or link. */
  | { kind: "invalid_or_expired" }
  | { kind: "invalid_email" }
  /** The server no longer knows our cursor: start over from null. */
  | { kind: "invalid_cursor" }
  /** 422: the account hit its storage quota. Retrying won't help. */
  | { kind: "quota_exceeded" }
  | { kind: "bad_request" }
  | { kind: "server"; status: number }
  /** The server answered something that doesn't match the contract. */
  | { kind: "bad_response" };

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export interface ApiClient {
  readonly baseUrl: string;
  requestMagicLink(email: string, locale: Locale): Promise<ApiResult<{ requestId: string }>>;
  verify(req: VerifyRequest): Promise<ApiResult<SessionResponse>>;
  logout(token: string): Promise<ApiResult<void>>;
  deleteAccount(token: string): Promise<ApiResult<void>>;
  sync(token: string, req: SyncRequest): Promise<ApiResult<SyncPage>>;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  now?: () => number;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** Responses larger than this are refused (a sync page is far below). */
const MAX_RESPONSE_CHARS = 20_000_000;

/** https anywhere; plain http only to this machine (dev). No credentials in the URL. */
export function isSecureBaseUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && (LOCAL_HOSTS.has(url.hostname) || url.hostname.endsWith(".localhost"));
}

/** `Retry-After` as delay-seconds or an HTTP date, clamped to [1 s, 1 h]. Defaults to 60 s. */
export function parseRetryAfter(header: string | null, now: number): number {
  const clamp = (ms: number) => Math.min(3_600_000, Math.max(1_000, ms));
  if (!header) return 60_000;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return clamp(Number(trimmed) * 1000);
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? 60_000 : clamp(at - now);
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const now = opts.now ?? Date.now;
  const secure = isSecureBaseUrl(opts.baseUrl);
  const base = opts.baseUrl.replace(/\/+$/, "");

  async function call(
    method: "GET" | "POST" | "DELETE",
    path: string,
    { token, body }: { token?: string; body?: unknown } = {},
  ): Promise<ApiResult<unknown>> {
    if (!secure) return { ok: false, error: { kind: "insecure" } };
    if (token !== undefined && !isSafeToken(token)) return { ok: false, error: { kind: "unauthorized" } };
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token !== undefined) headers.Authorization = `Bearer ${token}`;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        // Bearer auth only: no cookies, no following redirects (a redirect could carry the
        // Authorization header somewhere else), nothing cached, no referrer.
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch {
      return { ok: false, error: { kind: "network" } };
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (res.status === 401) return { ok: false, error: { kind: "unauthorized" } };
    if (res.status === 429) {
      return { ok: false, error: { kind: "rate_limited", retryAfterMs: parseRetryAfter(res.headers.get("Retry-After"), now()) } };
    }
    let text = "";
    try {
      text = await res.text();
    } catch {
      return { ok: false, error: { kind: "network" } };
    }
    let json: unknown = null;
    if (text) {
      if (text.length > MAX_RESPONSE_CHARS) return { ok: false, error: { kind: "bad_response" } };
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (res.status < 200 || res.status >= 300) {
      // Error bodies are `{ error: ApiErrorCode, detail? }`; only the code is used (never displayed raw).
      const code = typeof json === "object" && json !== null ? (json as { error?: unknown }).error : undefined;
      if (res.status === 422 || code === "quota_exceeded") return { ok: false, error: { kind: "quota_exceeded" } };
      if (res.status === 400 && (code === "invalid_or_expired" || code === "invalid_email" || code === "invalid_cursor")) {
        return { ok: false, error: { kind: code } };
      }
      if (res.status >= 400 && res.status < 500) return { ok: false, error: { kind: "bad_request" } };
      return { ok: false, error: { kind: "server", status: res.status } };
    }
    return { ok: true, value: json };
  }

  return {
    baseUrl: base,

    async requestMagicLink(email, locale) {
      const r = await call("POST", "/v1/auth/magic-link", { body: { email, locale } });
      if (!r.ok) return r;
      const requestId = (r.value as { requestId?: unknown } | null)?.requestId;
      return isId(requestId) ? { ok: true, value: { requestId } } : { ok: false, error: { kind: "bad_response" } };
    },

    async verify(req) {
      const r = await call("POST", "/v1/auth/verify", { body: req });
      if (!r.ok) return r;
      const s = parseSession(r.value);
      return s.ok ? s : { ok: false, error: { kind: "bad_response" } };
    },

    async logout(token) {
      // Every POST must be JSON (the API answers 415 otherwise), even without a payload.
      const r = await call("POST", "/v1/auth/logout", { token, body: {} });
      return r.ok ? { ok: true, value: undefined } : r;
    },

    async deleteAccount(token) {
      const r = await call("DELETE", "/v1/me", { token });
      return r.ok ? { ok: true, value: undefined } : r;
    },

    async sync(token, req) {
      const r = await call("POST", "/v1/sync", { token, body: req });
      if (!r.ok) return r;
      const page = parseSyncPage(r.value, now());
      return page.ok ? page : { ok: false, error: { kind: "bad_response" } };
    },
  };
}
