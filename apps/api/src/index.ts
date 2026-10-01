/**
 * Process wiring: config → database → mailer → app → Bun.serve, plus periodic cleanup and
 * graceful shutdown. All logic lives in the injected modules.
 */
import { createApp } from "./app.ts";
import { ConfigError, loadConfig, type Config } from "./config.ts";
import { openDatabase } from "./db.ts";
import { createDevConsoleMailer, createSmtpMailer } from "./mailer.ts";
import { HOUR } from "./rate-limit.ts";

let config: Config;
try {
  config = loadConfig(process.env);
} catch (e) {
  console.error(e instanceof ConfigError ? e.message : e);
  console.error("Refusing to start. See apps/api/.env.example.");
  process.exit(1);
}

if (config.ephemeralSecret) {
  console.warn("[dev] AUTH_SECRET not set: using a random one; sessions will not survive a restart.");
}

const db = openDatabase(config.databasePath);
const mailer = config.smtp
  ? createSmtpMailer(config.smtp, { requireTls: config.env === "production" })
  : createDevConsoleMailer(config.env);
if (!config.smtp) console.warn("[dev] SMTP not configured: login codes are printed to this console (DEV ONLY).");

const app = createApp({ db, mailer, config });

const server = Bun.serve({
  port: config.port,
  hostname: config.hostname,
  ...app.serve,
});

const runCleanup = () => {
  try {
    const removed = app.cleanup();
    if (removed) console.log(`cleanup: removed ${removed} expired login requests/sessions`);
  } catch (e) {
    console.error("cleanup failed", e);
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
