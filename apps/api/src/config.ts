/**
 * Environment parsing and validation. Every variable is documented in `apps/api/.env.example`.
 *
 * Fails closed: in production a missing or weak setting stops the process instead of
 * silently falling back to a development default.
 */
export type Env = "production" | "development" | "test";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string | undefined;
  pass: string | undefined;
  from: string;
}

export interface Config {
  env: Env;
  port: number;
  hostname: string;
  databasePath: string;
  /** HMAC pepper for login codes, link tokens and session tokens. Never logged. */
  authSecret: Buffer;
  /** True when AUTH_SECRET was not set and a random one was generated (dev only). */
  ephemeralSecret: boolean;
  /** Base URL of the web app, used to build the emailed sign-in link. No trailing slash. */
  appUrl: string;
  /** Exact origins allowed by CORS. Never contains "*". */
  corsOrigins: ReadonlySet<string>;
  /** Number of reverse-proxy hops to trust in X-Forwarded-For. 0 = use the socket address only. */
  trustProxyHops: number;
  /** null → development console mailer (refused in production). */
  smtp: SmtpConfig | null;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join("\n  - ")}`);
  }
}

export const MIN_SECRET_BYTES = 32;

export const DEV_CORS_ORIGINS = [
  "http://localhost:5173", // app (vite)
  "http://localhost:4321", // landing (astro)
  "capacitor://localhost", // Capacitor iOS webview
  "http://localhost", // Capacitor Android webview (legacy http scheme)
  "https://localhost", // Capacitor Android webview (default https scheme)
];

// scheme://host[:port] with nothing else (no path, no trailing slash, no credentials, no wildcard).
const ORIGIN = /^(https?|capacitor|ionic):\/\/[a-z0-9.-]+(:\d{1,5})?$/;
const HEADER_UNSAFE = /[\r\n\x00]/;

type RawEnv = Record<string, string | undefined>;

export function loadConfig(raw: RawEnv): Config {
  const problems: string[] = [];
  const get = (name: string) => {
    const v = raw[name]?.trim();
    return v ? v : undefined;
  };

  const env: Env = raw.NODE_ENV === "production" ? "production" : raw.NODE_ENV === "test" ? "test" : "development";
  const prod = env === "production";

  // --- server ---
  const port = parseIntStrict(get("PORT") ?? "3001");
  if (port === null || port < 0 || port > 65535) problems.push("PORT must be an integer between 0 and 65535");
  const hostname = get("HOST") ?? "0.0.0.0";
  const databasePath = get("DATABASE_PATH") ?? "cold-forge.sqlite";

  // --- secret ---
  let authSecret: Buffer;
  let ephemeralSecret = false;
  const secret = raw.AUTH_SECRET; // not trimmed: the exact bytes are the key
  if (secret) {
    authSecret = Buffer.from(secret, "utf8");
    if (authSecret.length < MIN_SECRET_BYTES) {
      problems.push(`AUTH_SECRET must be at least ${MIN_SECRET_BYTES} bytes (generate one with: openssl rand -base64 48)`);
    }
  } else if (prod) {
    problems.push("AUTH_SECRET is required in production");
    authSecret = Buffer.alloc(0);
  } else {
    authSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(48)));
    ephemeralSecret = true;
  }

  // --- app url ---
  const appUrlRaw = get("APP_URL") ?? (prod ? undefined : "http://localhost:5173");
  let appUrl = "";
  if (!appUrlRaw) {
    problems.push("APP_URL is required in production");
  } else {
    const parsed = safeUrl(appUrlRaw);
    if (!parsed || (parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password) {
      problems.push("APP_URL must be an http(s) URL without credentials");
    } else if (prod && parsed.protocol !== "https:") {
      problems.push("APP_URL must use https in production");
    } else if (parsed.search || parsed.hash) {
      problems.push("APP_URL must not contain a query or fragment");
    } else {
      appUrl = parsed.href.replace(/\/+$/, "");
    }
  }

  // --- CORS ---
  const corsRaw = get("CORS_ORIGINS");
  const corsList = corsRaw ? corsRaw.split(",").map((o) => o.trim()).filter(Boolean) : prod ? [] : DEV_CORS_ORIGINS;
  if (prod && !corsRaw) problems.push("CORS_ORIGINS is required in production");
  for (const origin of corsList) {
    if (!ORIGIN.test(origin)) problems.push(`CORS_ORIGINS entry is not an exact origin: ${JSON.stringify(origin)}`);
  }

  // --- proxy ---
  const trustRaw = get("TRUST_PROXY") ?? "0";
  const trustProxyHops = parseIntStrict(trustRaw);
  if (trustProxyHops === null || trustProxyHops < 0 || trustProxyHops > 10) {
    problems.push("TRUST_PROXY must be 0 (direct) or the number of trusted proxy hops (1-10)");
  }

  // --- SMTP ---
  let smtp: SmtpConfig | null = null;
  const smtpHost = get("SMTP_HOST");
  if (smtpHost) {
    const smtpPort = parseIntStrict(get("SMTP_PORT") ?? "587");
    if (smtpPort === null || smtpPort < 1 || smtpPort > 65535) problems.push("SMTP_PORT must be a valid port");
    const secureRaw = get("SMTP_SECURE");
    if (secureRaw !== undefined && !["true", "false", "1", "0"].includes(secureRaw)) {
      problems.push("SMTP_SECURE must be true/false");
    }
    const secure = secureRaw === undefined ? smtpPort === 465 : secureRaw === "true" || secureRaw === "1";
    const user = get("SMTP_USER");
    const pass = raw.SMTP_PASS || undefined;
    if (Boolean(user) !== Boolean(pass)) problems.push("SMTP_USER and SMTP_PASS must be set together");
    const from = get("MAIL_FROM");
    if (!from) problems.push("MAIL_FROM is required when SMTP_HOST is set");
    else if (HEADER_UNSAFE.test(from)) problems.push("MAIL_FROM must not contain line breaks");
    smtp = { host: smtpHost, port: smtpPort ?? 587, secure, user, pass, from: from ?? "" };
  } else if (prod) {
    problems.push("SMTP_HOST and MAIL_FROM are required in production");
  }

  if (problems.length) throw new ConfigError(problems);

  return {
    env,
    port: port!,
    hostname,
    databasePath,
    authSecret,
    ephemeralSecret,
    appUrl,
    corsOrigins: new Set(corsList),
    trustProxyHops: trustProxyHops!,
    smtp,
  };
}

function parseIntStrict(v: string): number | null {
  return /^\d{1,6}$/.test(v) ? Number(v) : null;
}

function safeUrl(v: string): URL | null {
  try {
    return new URL(v);
  } catch {
    return null;
  }
}


/** Milliseconds since the epoch. Injected so tests control time. */
export type Clock = () => number;
