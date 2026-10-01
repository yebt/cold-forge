/**
 * HTTP plumbing: JSON responses, security headers, CORS, client IP, bounded body reading.
 */
import { isIP } from "node:net";
import { LIMITS } from "@cold-forge/sync";

/** Thrown by handlers/helpers; turned into `{ error: code }` with this status. Never carries internals. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(code);
  }
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

export const errorResponse = (status: number, code: string, headers: Record<string, string> = {}) =>
  json({ error: code }, status, headers);

// --- security headers ---------------------------------------------------------------------------

export function applySecurityHeaders(headers: Headers, production: boolean): void {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  // Everything this API returns is either auth material or personal data: never cache it.
  headers.set("Cache-Control", "no-store");
  headers.set("Pragma", "no-cache");
  headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (production) headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
}

// --- CORS ---------------------------------------------------------------------------------------

export const CORS_METHODS = "GET, POST, DELETE, OPTIONS";
const CORS_ALLOWED_HEADERS = new Set(["authorization", "content-type"]);

/** Adds CORS headers for an allowed origin. Never reflects an origin that is not on the allowlist. */
export function applyCors(headers: Headers, origin: string | null, allowed: ReadonlySet<string>): void {
  headers.append("Vary", "Origin");
  if (origin && allowed.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
}

/** Answers an OPTIONS preflight. */
export function preflight(req: Request, allowed: ReadonlySet<string>): Response {
  const origin = req.headers.get("Origin");
  if (!origin || !allowed.has(origin)) return errorResponse(403, "origin_not_allowed");
  const method = req.headers.get("Access-Control-Request-Method") ?? "";
  if (!["GET", "POST", "DELETE"].includes(method)) return errorResponse(403, "method_not_allowed");
  const requested = (req.headers.get("Access-Control-Request-Headers") ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (requested.some((h) => !CORS_ALLOWED_HEADERS.has(h))) return errorResponse(403, "header_not_allowed");
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": CORS_METHODS,
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "600",
    },
  });
}

// --- client IP ----------------------------------------------------------------------------------

/**
 * The client IP used for rate limiting. Uses the socket address unless `trustProxyHops > 0`,
 * in which case it takes the entry `trustProxyHops` positions from the right of X-Forwarded-For
 * (the address our own trusted proxy saw). Anything a client prepends further left is ignored.
 */
export function clientIp(socketIp: string | null | undefined, xff: string | null, trustProxyHops: number): string {
  const socket = socketIp && isIP(socketIp) ? socketIp : "unknown";
  if (trustProxyHops <= 0 || !xff) return socket;
  const hops = xff.split(",").map((s) => s.trim());
  const candidate = hops[hops.length - trustProxyHops];
  return candidate && isIP(candidate) ? candidate : socket;
}

// --- body ---------------------------------------------------------------------------------------

/** Requires `Content-Type: application/json` (optionally `; charset=utf-8`). */
export function requireJsonContentType(req: Request): void {
  const raw = req.headers.get("Content-Type");
  if (!raw) throw new HttpError(415, "unsupported_media_type");
  const [type, ...params] = raw.split(";").map((s) => s.trim().toLowerCase());
  if (type !== "application/json") throw new HttpError(415, "unsupported_media_type");
  for (const p of params) {
    if (p && p !== "charset=utf-8") throw new HttpError(415, "unsupported_media_type");
  }
}

/**
 * Reads and parses a JSON body, never buffering more than `maxBytes`: rejects early on
 * Content-Length and again while streaming (for chunked or lying requests).
 */
export async function readJson(req: Request, maxBytes: number = LIMITS.maxBodyBytes): Promise<unknown> {
  requireJsonContentType(req);
  const declared = req.headers.get("Content-Length");
  if (declared !== null) {
    if (!/^\d{1,12}$/.test(declared)) throw new HttpError(400, "invalid_content_length");
    if (Number(declared) > maxBytes) throw new HttpError(413, "payload_too_large");
  }
  if (!req.body) throw new HttpError(400, "invalid_json");

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = req.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new HttpError(413, "payload_too_large");
      chunks.push(value);
    }
  } finally {
    // On early exit, stop reading the rest of the request.
    reader.cancel().catch(() => {});
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total));
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

/** Extracts the token from `Authorization: Bearer <token>`. Cookies are never consulted. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization");
  if (!header) return null;
  const m = /^Bearer ([A-Za-z0-9_-]{1,128})$/.exec(header);
  return m ? m[1]! : null;
}
