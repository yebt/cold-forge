/**
 * Process wiring: config → database → mailer → app → Bun.serve, plus periodic cleanup and
 * graceful shutdown. All logic lives in the injected modules.
 *
 * Logging: only fixed messages, counts and error classes/codes. Never an email address, login
 * code, token, request body or raw error object (they can carry any of those).
 */
import { createApp, describeError } from "./app.ts";
import { ConfigError, loadConfig, type Config } from "./config.ts";
import { openDatabase, restrictDatabaseFiles } from "./db.ts";
import { createDevConsoleMailer, createSmtpMailer } from "./mailer.ts";
import { HOUR } from "./rate-limit.ts";

// Everything this process creates (the SQLite db and its -wal/-shm files) is owner-only.
process.umask(0o077);

let config: Config;
try {
  config = loadConfig(process.env);
} catch (e) {
  console.error(e instanceof ConfigError ? e.message : describeError(e, true));
  console.error("Refusing to start. See apps/api/.env.example.");
  process.exit(1);
}

if (config.ephemeralSecret) {
  console.warn(`[${config.env}] AUTH_SECRET not set: using a random one; sessions will not survive a restart.`);
}

const db = openDatabase(config.databasePath);
// Files that already existed keep their old mode under umask: tighten them explicitly.
restrictDatabaseFiles(config.databasePath);

const mailer = config.smtp ? createSmtpMailer(config.smtp) : createDevConsoleMailer(config.env);
if (config.devConsoleMailer) {
  console.warn("[dev] DEV_CONSOLE_MAILER=1: login codes are printed to this console instead of emailed (DEV ONLY).");
}
if (config.smtp && !config.smtp.secure && !config.smtp.requireTls) {
  console.warn("[dev] SMTP_INSECURE_DEV=1: login emails may be sent without TLS (DEV ONLY).");
}

const app = createApp({ db, mailer, config });

const server = Bun.serve({
  port: config.port,
  hostname: config.hostname,
  ...app.serve,
});
// The -wal/-shm files may be created lazily on the first write: tighten again once serving.
restrictDatabaseFiles(config.databasePath);

const runCleanup = () => {
  try {
    const removed = app.cleanup();
    if (removed) console.log(`cleanup: removed ${removed} expired login requests/sessions`);
  } catch (e) {
    console.error(`cleanup failed: ${describeError(e, config.env === "production")}`);
  }
};
runCleanup();
const cleanupTimer = setInterval(runCleanup, HOUR);

console.log(`COLD FORGE API (${config.env}) listening on ${server.url}`);

function shutdown(signal: string) {
  console.log(`${signal}: shutting down`);
  clearInterval(cleanupTimer);
  server.stop();
  db.close();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
