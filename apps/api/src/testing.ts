/** Test harness: real HTTP server on port 0, in-memory DB, fake mailer, fake clock. Not used in production. */
import type { SessionResponse, SyncChanges } from "@cold-forge/sync";
import { createApp, type AppDeps } from "./app.ts";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db.ts";
import type { LoginEmail, Mailer } from "./mailer.ts";

export const T0 = Date.parse("2026-10-05T12:00:00.000Z");
export const APP_ORIGIN = "https://app.example.com";

export interface Harness {
  url: string;
  db: ReturnType<typeof openDatabase>;
  mails: LoginEmail[];
  logs: string[];
  clock: { now: number };
  app: ReturnType<typeof createApp>;
  advance(ms: number): void;
  request(method: string, path: string, opts?: RequestOpts): Promise<Response>;
  post(path: string, body: unknown, opts?: RequestOpts): Promise<Response>;
  login(email: string): Promise<SessionResponse>;
  sync(token: string, changes: Partial<SyncChanges>, cursor?: string | null): Promise<Response>;
  stop(): void;
}

export interface RequestOpts {
  token?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
}

export function startHarness(
  overrides: Partial<Omit<AppDeps, "db" | "mailer" | "config">> & { env?: Record<string, string> } = {},
): Harness {
  const clock = { now: T0 };
  const db = openDatabase(":memory:");
  const mails: LoginEmail[] = [];
  const logs: string[] = [];
  const mailer: Mailer = {
    async sendLoginEmail(m) {
      mails.push(m);
    },
  };
  const config = loadConfig({
    NODE_ENV: "test",
    AUTH_SECRET: "test-secret-test-secret-test-secret-0123456789",
    APP_URL: APP_ORIGIN,
    CORS_ORIGINS: `${APP_ORIGIN},capacitor://localhost`,
    ...overrides.env,
  });
  const app = createApp({
    db,
    mailer,
    config,
    clock: () => clock.now,
    log: (m) => logs.push(m),
    ...overrides,
  });
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", ...app.serve });
  const url = server.url.href.replace(/\/$/, "");

  const request = (method: string, path: string, opts: RequestOpts = {}) =>
    fetch(url + path, {
      method,
      headers: { ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), ...opts.headers },
      body: opts.body,
    });

  const post = (path: string, body: unknown, opts: RequestOpts = {}) =>
    request("POST", path, {
      ...opts,
      headers: { "Content-Type": "application/json", ...opts.headers },
      body: opts.body ?? JSON.stringify(body),
    });

  const h: Harness = {
    url,
    db,
    mails,
    logs,
    clock,
    app,
    advance: (ms) => void (clock.now += ms),
    request,
    post,
    async login(email) {
      const res = await post("/v1/auth/magic-link", { email, locale: "en" });
      if (res.status !== 202) throw new Error(`magic-link failed: ${res.status}`);
      const { requestId } = (await res.json()) as { requestId: string };
      const mail = mails.at(-1)!;
      const verified = await post("/v1/auth/verify", { requestId, code: mail.code });
      if (verified.status !== 200) throw new Error(`verify failed: ${verified.status}`);
      return (await verified.json()) as SessionResponse;
    },
    sync: (token, changes, cursor = null) =>
      post(
        "/v1/sync",
        { protocol: 1, cursor, changes: { arcs: [], habits: [], checkIns: [], profile: null, ...changes } },
        { token },
      ),
    stop() {
      server.stop(true);
      db.close();
    },
  };
  return h;
}

export const iso = (ms: number) => new Date(ms).toISOString();
