import { describe, expect, test } from "bun:test";
import { ConfigError, DEV_CORS_ORIGINS, loadConfig } from "./config.ts";

const SECRET = "s".repeat(48);
const PROD = {
  NODE_ENV: "production",
  AUTH_SECRET: SECRET,
  APP_URL: "https://coldforge.app",
  CORS_ORIGINS: "https://coldforge.app,capacitor://localhost,https://localhost",
  SMTP_HOST: "smtp.example.com",
  SMTP_USER: "u",
  SMTP_PASS: "p",
  MAIL_FROM: "COLD FORGE <login@coldforge.app>",
};

const problems = (env: Record<string, string | undefined>) => {
  try {
    loadConfig(env);
    return [];
  } catch (e) {
    if (e instanceof ConfigError) return e.problems;
    throw e;
  }
};

describe("config", () => {
  test("valid production config", () => {
    const c = loadConfig(PROD);
    expect(c.env).toBe("production");
    expect(c.smtp?.port).toBe(587);
    expect(c.corsOrigins.has("capacitor://localhost")).toBe(true);
    expect(c.trustProxyHops).toBe(0);
  });

  test.each(["AUTH_SECRET", "APP_URL", "CORS_ORIGINS", "SMTP_HOST", "MAIL_FROM"])(
    "production refuses to start without %s",
    (name) => {
      expect(problems({ ...PROD, [name]: undefined }).length).toBeGreaterThan(0);
    },
  );

  test("short secrets are rejected everywhere", () => {
    expect(problems({ ...PROD, AUTH_SECRET: "x".repeat(31) })).toHaveLength(1);
    expect(problems({ AUTH_SECRET: "short" })).toHaveLength(1);
  });

  test("production requires https APP_URL", () => {
    expect(problems({ ...PROD, APP_URL: "http://coldforge.app" })).toHaveLength(1);
  });

  test("CORS rejects wildcards and non-origins", () => {
    for (const bad of ["*", "https://a.com/", "https://a.com/path", "null", "https://*.a.com"]) {
      expect(problems({ ...PROD, CORS_ORIGINS: bad }).length).toBeGreaterThan(0);
    }
  });

  test("MAIL_FROM cannot inject headers", () => {
    expect(problems({ ...PROD, MAIL_FROM: "a@b.com\r\nBcc: x@y.com" })).toHaveLength(1);
  });

  test("development defaults: ephemeral secret, dev origins, console mailer", () => {
    const c = loadConfig({});
    expect(c.env).toBe("development");
    expect(c.ephemeralSecret).toBe(true);
    expect(c.authSecret.length).toBeGreaterThanOrEqual(32);
    expect([...c.corsOrigins]).toEqual(DEV_CORS_ORIGINS);
    expect(c.smtp).toBeNull();
  });
});
