/**
 * Environment parsing and validation. Every variable is documented in `apps/api/.env.example`.
 *
 * Fails closed: NODE_ENV must be exactly production/development/test (anything else refuses to
 * start), and in production a missing or weak setting stops the process instead of silently
 * falling back to a development default. The console mailer needs an explicit opt-in on a
 * loopback-only development server.
 */
export type Env = "production" | "development" | "test";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string | undefined;
  pass: string | undefined;
  from: string;
  /** Refuse to send unless the connection is upgraded with STARTTLS (always true unless secure, or SMTP_INSECURE_DEV=1 in development). */
  requireTls: boolean;
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
  /** null → development console mailer (only with devConsoleMailer). */
  smtp: SmtpConfig | null;
  /** True only for NODE_ENV=development + DEV_CONSOLE_MAILER=1 + a loopback HOST. */
  devConsoleMailer: boolean;
  /** Global cap on login emails sent per hour (MAIL_HOURLY_CAP). */
  mailHourlyCap: number;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join("\n  - ")}`);
  }
}

export const MIN_SECRET_BYTES = 32;
export const MIN_SECRET_DISTINCT_CHARS = 16;
export const ENVS: readonly Env[] = ["production", "development", "test"];
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
/** The only non-https origins allowed in production: the Capacitor webviews. */
const CAPACITOR_ORIGINS = new Set(["capacitor://localhost", "https://localhost", "http://localhost"]);

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

  const envRaw = (raw.NODE_ENV ?? "").trim().toLowerCase();
  if (!(ENVS as readonly string[]).includes(envRaw)) {
    // Nothing else is meaningful without a known environment: stop here.
    throw new ConfigError([
      `NODE_ENV must be one of ${ENVS.join(", ")} (got ${raw.NODE_ENV === undefined ? "nothing" : JSON.stringify(raw.NODE_ENV)}). ` +
        "Use `bun run dev` / `bun run start`, or set it explicitly.",
    ]);
  }
  const env = envRaw as Env;
  const prod = env === "production";
  const dev = env === "development";

  // --- server ---
  const port = parseIntStrict(get("PORT") ?? "3001");
  if (port === null || port < 0 || port > 65535) problems.push("PORT must be an integer between 0 and 65535");
  // Development listens on loopback only unless HOST says otherwise.
  const hostname = get("HOST") ?? (prod ? "0.0.0.0" : "127.0.0.1");
  const databasePath = get("DATABASE_PATH") ?? "cold-forge.sqlite";

  // --- secret ---
  let authSecret: Buffer;
  let ephemeralSecret = false;
  const secret = raw.AUTH_SECRET; // not trimmed: the exact bytes are the key
  if (secret) {
    authSecret = Buffer.from(secret, "utf8");
    if (authSecret.length < MIN_SECRET_BYTES) {
      problems.push(`AUTH_SECRET must be at least ${MIN_SECRET_BYTES} bytes (generate one with: openssl rand -base64 48)`);
    } else if (prod && new Set(secret).size < MIN_SECRET_DISTINCT_CHARS) {
      problems.push(
        `AUTH_SECRET looks low-entropy (fewer than ${MIN_SECRET_DISTINCT_CHARS} distinct characters); ` +
          "generate one with: openssl rand -base64 48",
      );
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
    } else if (parsed.search || parsed.hash || appUrlRaw.includes("?") || appUrlRaw.includes("#")) {
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
    else if (prod && !origin.startsWith("https://") && !CAPACITOR_ORIGINS.has(origin)) {
      problems.push(
        `CORS_ORIGINS entry must be https in production (only the Capacitor origins ${[...CAPACITOR_ORIGINS].join(", ")} are exempt): ${JSON.stringify(origin)}`,
      );
    }
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
  const insecureDev = get("SMTP_INSECURE_DEV") === "1";
  if (insecureDev && !dev) problems.push("SMTP_INSECURE_DEV=1 is only allowed with NODE_ENV=development");
  const consoleOptIn = get("DEV_CONSOLE_MAILER") === "1";
  if (consoleOptIn && !dev) problems.push("DEV_CONSOLE_MAILER=1 is only allowed with NODE_ENV=development");
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
    const requireTls = !secure && !(dev && insecureDev);
    smtp = { host: smtpHost, port: smtpPort ?? 587, secure, user, pass, from: from ?? "", requireTls };
  }
  const devConsoleMailer = !smtp && dev && consoleOptIn && LOOPBACK_HOSTS.has(hostname);
  if (!smtp && !devConsoleMailer) {
    problems.push(
      dev && consoleOptIn
        ? "DEV_CONSOLE_MAILER=1 requires a loopback HOST (127.0.0.1, ::1 or localhost); otherwise set SMTP_HOST and MAIL_FROM"
        : "SMTP_HOST and MAIL_FROM are required (development may set DEV_CONSOLE_MAILER=1 to print codes to the console)",
    );
  }

  // --- global mail cap ---
  const capRaw = get("MAIL_HOURLY_CAP") ?? "500";
  const mailHourlyCap = parseIntStrict(capRaw);
  if (mailHourlyCap === null || mailHourlyCap < 1) problems.push("MAIL_HOURLY_CAP must be a positive integer");

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
    devConsoleMailer,
    mailHourlyCap: mailHourlyCap!,
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
