/**
 * Regression tests for the independent security review (M1–M5, L1–L5, info items).
 * Each `describe` names the finding; the PoCs they replace are summarized in the test names.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { addDays } from "@cold-forge/core";
import type { SessionResponse } from "@cold-forge/sync";
import { MAX_FAILED_CODES_PER_EMAIL, SESSION_MAX_AGE_MS } from "./auth.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { clientIp, ipRateKey } from "./http.ts";
import { createSmtpMailer, mailErrorSummary } from "./mailer.ts";
import { DAY, HOUR, MemoryRateLimiter, MINUTE, createMemoryLimiters } from "./rate-limit.ts";
import { startHarness, T0, type Harness } from "./testing.ts";

let h: Harness | undefined;
afterEach(() => {
  h?.stop();
  h = undefined;
});

const xff = (ip: string) => ({ headers: { "X-Forwarded-For": ip } });
const magic = (hh: Harness, email: string, ip?: string) =>
  hh.post("/v1/auth/magic-link", { email, locale: "en" }, ip ? xff(ip) : {});
const json = async <T>(res: Response) => (await res.json()) as T;

describe("M1: a stranger cannot lock the owner out", () => {
  test("PoC lockout: attacker requests do not invalidate the victim's code and do not exhaust the victim's budget", async () => {
    h = startHarness({ env: { TRUST_PROXY: "1" } });
    const VICTIM_IP = "198.51.100.7";
    const ATTACKER_IP = "203.0.113.9";
    const v = await json<{ requestId: string }>(await magic(h, "victim@example.com", VICTIM_IP));
    const victimCode = h.mails.at(-1)!.code;
    h.advance(31_000);
    await magic(h, "victim@example.com", ATTACKER_IP); // attacker asks once
    const r = await h.post("/v1/auth/verify", { requestId: v.requestId, code: victimCode }, xff(VICTIM_IP));
    expect(r.status).toBe(200); // the attacker's request did not kill the victim's code

    // Attacker hammers from one IP all day: at most 3 per 15 min for that (email, IP) pair.
    let victimSends = 0;
    for (let i = 0; i < 40; i++) {
      h.advance(31_000);
      await magic(h, "victim@example.com", ATTACKER_IP);
      h.advance(31_000);
      const before = h.mails.length;
      const res = await magic(h, "victim@example.com", VICTIM_IP);
      expect(res.status).toBe(202);
      if (h.mails.length > before) victimSends++;
      h.advance(15 * MINUTE);
    }
    // The victim keeps getting emails long after the old "10/day" budget would have run out.
    expect(victimSends).toBeGreaterThanOrEqual(9);
  });

  test("up to 3 pending requests stay valid; the 4th evicts only the oldest", async () => {
    h = startHarness({ env: { TRUST_PROXY: "1" } });
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push((await json<{ requestId: string }>(await magic(h, "a@example.com", `10.0.0.${i}`))).requestId);
      h.advance(31_000);
    }
    expect(h.mails).toHaveLength(4);
    expect(h.db.query("SELECT COUNT(*) AS n FROM login_requests").get()).toEqual({ n: 3 });
    expect((await h.post("/v1/auth/verify", { requestId: ids[0], code: h.mails[0]!.code })).status).toBe(400);
    // each surviving request keeps its own 5-attempt cap
    const wrong = h.mails[1]!.code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++) await h.post("/v1/auth/verify", { requestId: ids[1], code: wrong });
    expect((await h.post("/v1/auth/verify", { requestId: ids[1], code: h.mails[1]!.code })).status).toBe(400);
    expect((await h.post("/v1/auth/verify", { requestId: ids[2], code: h.mails[2]!.code })).status).toBe(200);
    // ...and that success consumed the rest
    expect((await h.post("/v1/auth/verify", { requestId: ids[3], code: h.mails[3]!.code })).status).toBe(400);
  });
});

describe("M2: canonical emails reach the rate limiter and SMTP as one value", () => {
  test("PoC variants: invisible-character suffixes are rejected, not counted as new addresses", async () => {
    h = startHarness();
    for (const suffix of ["​", "­", "⁠", "️", "͏", "."]) {
      expect((await magic(h, `victim@example.com${suffix}`)).status).toBe(400);
    }
    expect((await magic(h, "victim@example.com")).status).toBe(202);
    expect(new Set(h.mails.map((m) => m.to))).toEqual(new Set(["victim@example.com"]));
  });

  test("Unicode and punycode spellings of a domain share one account", async () => {
    h = startHarness();
    const a = await h.login("victim@exämple.com");
    const b = await h.login("victim@xn--exmple-cua.com");
    expect(a.user.id).toBe(b.user.id);
    expect(a.user.email).toBe("victim@xn--exmple-cua.com");
  });

  test("nodemailer's envelope recipient equals the stored address", async () => {
    // jsonTransport reports the envelope nodemailer would hand to the SMTP server.
    const nodemailer = (await import("nodemailer")).default;
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const envelopes: string[] = [];
    const mailer = createSmtpMailer(
      { host: "x", port: 587, secure: false, user: undefined, pass: undefined, from: "COLD FORGE <login@cf.test>", requireTls: true },
      {
        async sendMail(m) {
          const info = (await transport.sendMail(m)) as { envelope: { to: string[] } };
          envelopes.push(info.envelope.to.join(","));
        },
      },
    );
    h = startHarness({ mailer });
    const inputs = [
      "Yahir@Example.com",
      "victim@exämple.com",
      "victim@xn--exmple-cua.com",
      "o'brien+tag@example.co.uk",
      "x@ｅｘａｍｐｌｅ.com",
      "a#b$c%d&e*f/g=h?i^j_k`l{m|n}o~p-q!r@example.org",
      "u@café.example",
      "u@café.example",
    ];
    for (const email of inputs) {
      h.advance(31_000);
      expect((await magic(h, email)).status).toBe(202);
    }
    await Bun.sleep(20);
    const stored = (h.db.query("SELECT email FROM login_requests ORDER BY rowid").all() as { email: string }[]).map(
      (r) => r.email,
    );
    expect(envelopes).toHaveLength(stored.length);
    expect(envelopes).toEqual(stored);
    expect(stored).toContain("u@xn--caf-dma.example");
  });
});

describe("M3: IPv6 rotation and bucket eviction", () => {
  test("IPv6 keyed by /64 (expanded), IPv4-mapped → IPv4", () => {
    expect(ipRateKey("2001:db8::1")).toBe(ipRateKey("2001:db8:0:0:ffff:1:2:3"));
    expect(ipRateKey("2001:DB8:0:0::")).toBe("2001:db8:0:0::/64");
    expect(ipRateKey("2001:db8:0:1::1")).not.toBe(ipRateKey("2001:db8::1"));
    expect(ipRateKey("::ffff:10.0.0.1")).toBe("10.0.0.1");
    expect(ipRateKey("::ffff:a00:1")).toBe("10.0.0.1");
    expect(ipRateKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(ipRateKey("1.2.3.4")).toBe("1.2.3.4");
    expect(ipRateKey(clientIp(null, "2001:db8::abcd", 1))).toBe("2001:db8:0:0::/64");
  });

  test("rotating /128s inside one /64 shares the per-IP magic-link limit", async () => {
    h = startHarness({ env: { TRUST_PROXY: "1" } });
    for (let i = 0; i < 10; i++) {
      expect((await magic(h, `u${i}@example.com`, `2001:db8::${(i + 1).toString(16)}`)).status).toBe(202);
    }
    expect((await magic(h, "u10@example.com", "2001:db8::ffff")).status).toBe(429);
  });

  test("a full store never evicts live buckets; it evicts expired ones LRU-first", () => {
    let now = 0;
    const rl = new MemoryRateLimiter(() => now, { maxBuckets: 3, failClosed: true });
    const rule = [{ limit: 1, windowMs: 1000 }];
    const long = [{ limit: 1, windowMs: 10_000 }];
    expect(rl.takeSync("victim", long)).toBe(true);
    expect(rl.takeSync("a", rule)).toBe(true);
    expect(rl.takeSync("b", rule)).toBe(true);
    expect(rl.takeSync("c", rule)).toBe(false); // full of live buckets: fail closed
    now = 1500; // a and b expired, victim still live
    expect(rl.takeSync("c", rule)).toBe(true);
    expect(rl.takeSync("d", rule)).toBe(true);
    expect(rl.takeSync("victim", long)).toBe(false); // never evicted: still limited
  });

  test("PoC eviction: flooding the general store cannot reset the per-email limit", async () => {
    // Small stores so the flood is cheap; the auth store is separate and fails closed.
    let full = "";
    h = startHarness({
      env: { TRUST_PROXY: "1" },
      limiters: (() => {
        const l = createMemoryLimiters(() => h!.clock.now, (s) => (full = s));
        return {
          ...l,
          general: new MemoryRateLimiter(() => h!.clock.now, { maxBuckets: 50, failClosed: false, onFull: () => (full = "general") }),
        };
      })(),
    });
    for (let i = 0; i < 3; i++) {
      await magic(h, "victim@example.com", "2001:db8::1");
      h.advance(31_000);
    }
    expect(h.mails).toHaveLength(3);
    await Promise.all(
      Array.from({ length: 300 }, (_, i) => h!.request("GET", "/x", xff(`2001:db8:${i.toString(16)}::1`)).then((r) => r.arrayBuffer())),
    );
    expect(full).toBe("general");
    await magic(h, "victim@example.com", "2001:db8::2");
    expect(h.mails).toHaveLength(3); // (email, IP) bucket survived the flood
  });

  test("auth store full of live buckets fails closed (429)", async () => {
    h = startHarness({
      limiters: {
        ...createMemoryLimiters(() => h!.clock.now),
        auth: new MemoryRateLimiter(() => h!.clock.now, { maxBuckets: 0, failClosed: true }),
      },
    });
    expect((await magic(h, "a@example.com")).status).toBe(429);
    expect((await h.post("/v1/auth/verify", { requestId: crypto.randomUUID(), code: "123456" })).status).toBe(429);
  });

  test("global cap on outgoing login emails: still 202, nothing sent, warning logged", async () => {
    h = startHarness({ env: { MAIL_HOURLY_CAP: "3", TRUST_PROXY: "1" } });
    for (let i = 0; i < 5; i++) expect((await magic(h, `p${i}@example.com`, `10.1.0.${i}`)).status).toBe(202);
    expect(h.mails).toHaveLength(3);
    expect(h.logs.some((l) => l.includes("MAIL_HOURLY_CAP"))).toBe(true);
    expect(h.logs.join()).not.toContain("@example.com");
    h.advance(HOUR);
    await magic(h, "p9@example.com", "10.1.1.1");
    expect(h.mails).toHaveLength(4);
  });
});

describe("M4: fail closed on NODE_ENV and insecure settings", () => {
  const problems = (env: Record<string, string | undefined>) => {
    try {
      loadConfig(env);
      return [];
    } catch (e) {
      if (e instanceof ConfigError) return e.problems;
      throw e;
    }
  };
  const PROD = {
    NODE_ENV: "production",
    AUTH_SECRET: "kQ9v2Zr7Xw4Lp1Hs8Ty3Bn6Mc0Df5Gj+/Ae",
    APP_URL: "https://coldforge.app",
    CORS_ORIGINS: "https://coldforge.app,capacitor://localhost,https://localhost,http://localhost",
    SMTP_HOST: "smtp.example.com",
    MAIL_FROM: "login@coldforge.app",
  };

  test("PoC cfg: unset or unknown NODE_ENV refuses to start", () => {
    for (const NODE_ENV of [undefined, "", "prod", "staging", "Production-ish"]) {
      expect(() => loadConfig({ NODE_ENV, APP_URL: "http://api.example.com", CORS_ORIGINS: "http://evil.example" })).toThrow(
        ConfigError,
      );
    }
    // case/whitespace are normalized, so " Production" is production with all its checks
    expect(problems({ NODE_ENV: " Production", APP_URL: "http://x.com" }).length).toBeGreaterThan(2);
    expect(loadConfig({ ...PROD, NODE_ENV: " PRODUCTION " }).env).toBe("production");
  });

  test("console mailer only with development + DEV_CONSOLE_MAILER=1 + loopback HOST", () => {
    expect(loadConfig({ NODE_ENV: "development", DEV_CONSOLE_MAILER: "1" }).devConsoleMailer).toBe(true);
    expect(loadConfig({ NODE_ENV: "development", DEV_CONSOLE_MAILER: "1", HOST: "::1" }).devConsoleMailer).toBe(true);
    expect(problems({ NODE_ENV: "development" }).length).toBe(1); // no SMTP, no opt-in
    expect(problems({ NODE_ENV: "development", DEV_CONSOLE_MAILER: "1", HOST: "0.0.0.0" }).length).toBe(1);
    expect(problems({ NODE_ENV: "test", DEV_CONSOLE_MAILER: "1" }).length).toBeGreaterThan(0);
    expect(problems({ ...PROD, SMTP_HOST: undefined, DEV_CONSOLE_MAILER: "1" }).length).toBeGreaterThan(0);
  });

  test("SMTP requires STARTTLS unless implicit TLS, or SMTP_INSECURE_DEV=1 in development", () => {
    expect(loadConfig({ ...PROD, SMTP_PORT: "25", SMTP_SECURE: "false" }).smtp!.requireTls).toBe(true);
    expect(loadConfig({ ...PROD, SMTP_PORT: "465" }).smtp!.requireTls).toBe(false);
    const dev = { NODE_ENV: "development", SMTP_HOST: "localhost", SMTP_PORT: "1025", MAIL_FROM: "a@b.co" };
    expect(loadConfig(dev).smtp!.requireTls).toBe(true);
    expect(loadConfig({ ...dev, SMTP_INSECURE_DEV: "1" }).smtp!.requireTls).toBe(false);
    expect(problems({ ...PROD, SMTP_INSECURE_DEV: "1" }).length).toBe(1);
  });

  test("production CORS: https or the Capacitor webview origins only", () => {
    expect(loadConfig(PROD).corsOrigins.has("http://localhost")).toBe(true);
    for (const bad of ["http://coldforge.app", "http://localhost:5173", "ionic://localhost", "capacitor://evil"]) {
      expect(problems({ ...PROD, CORS_ORIGINS: bad }).length).toBe(1);
    }
  });

  test("production AUTH_SECRET entropy", () => {
    for (const weak of ["a".repeat(48), "abababababababababababababababab", "0123456789abcde0123456789abcde01"]) {
      const p = problems({ ...PROD, AUTH_SECRET: weak });
      expect(p).toHaveLength(1);
      expect(p[0]).toContain("openssl rand -base64 48");
    }
  });

  test("APP_URL: no query or fragment, not even empty ones", () => {
    for (const bad of ["https://x.com/#", "https://x.com/app?", "https://x.com/?a=1", "https://x.com/#/a"]) {
      expect(problems({ ...PROD, APP_URL: bad })).toHaveLength(1);
    }
  });

  test("MAIL_HOURLY_CAP is validated", () => {
    expect(loadConfig({ ...PROD, MAIL_HOURLY_CAP: "50" }).mailHourlyCap).toBe(50);
    expect(problems({ ...PROD, MAIL_HOURLY_CAP: "0" })).toHaveLength(1);
    expect(problems({ ...PROD, MAIL_HOURLY_CAP: "lots" })).toHaveLength(1);
  });
});

describe("M5: expensive authenticated requests", () => {
  const ts = new Date(T0 - 60_000).toISOString();
  const habits = Array.from({ length: 10 }, (_, i) => ({
    id: `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`,
    arcId: "11111111-1111-4111-8111-111111111111",
    name: "h",
    emoji: "🧊",
    order: i,
    createdAt: ts,
    updatedAt: ts,
  }));

  test("/v1/sync: 20 per minute per user", async () => {
    h = startHarness();
    const { token } = await h.login("a@example.com");
    for (let i = 0; i < 20; i++) expect((await h.sync(token, {})).status).toBe(200);
    expect((await h.sync(token, {})).status).toBe(429);
    expect((await h.request("GET", "/v1/me", { token })).status).toBe(200); // other routes unaffected
    h.advance(MINUTE);
    expect((await h.sync(token, {})).status).toBe(200);
  });

  test("/v1/export: 5 per hour per user", async () => {
    h = startHarness();
    const { token } = await h.login("a@example.com");
    for (let i = 0; i < 5; i++) expect((await h.request("GET", "/v1/export", { token })).status).toBe(200);
    expect((await h.request("GET", "/v1/export", { token })).status).toBe(429);
    h.advance(HOUR);
    expect((await h.request("GET", "/v1/export", { token })).status).toBe(200);
  });

  test("PoC dos: records written per user per minute are capped (cost-based)", async () => {
    h = startHarness();
    const { token } = await h.login("a@example.com");
    await h.sync(token, { habits });
    const statuses: number[] = [];
    for (let b = 0; b < 5; b++) {
      const checkIns = Array.from({ length: 5000 }, (_, i) => ({
        habitId: habits[b % 10]!.id,
        date: addDays("2000-01-01", i),
        done: true,
        updatedAt: ts,
      }));
      statuses.push((await h.sync(token, { checkIns })).status);
    }
    // 10 habits + 3×5000 = 15_010 records fit; the 4th batch would exceed 20_000/min
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    h.advance(MINUTE);
    expect((await h.sync(token, {})).status).toBe(200);
  }, 30_000);

  test("new accounts per IP per day are capped on verify (429); existing users can still sign in", async () => {
    h = startHarness();
    for (let i = 0; i < 5; i++) await h.login(`new${i}@example.com`);
    h.advance(31 * MINUTE);
    const res = await magic(h, "new5@example.com");
    const { requestId } = await json<{ requestId: string }>(res);
    const code = h.mails.at(-1)!.code;
    const denied = await h.post("/v1/auth/verify", { requestId, code });
    expect(denied.status).toBe(429);
    expect(h.db.query("SELECT COUNT(*) AS n FROM users").get()).toEqual({ n: 5 });
    // the denied request was not consumed (no oracle, no wasted code)
    expect(h.db.query("SELECT COUNT(*) AS n FROM login_requests WHERE id = ?").get(requestId)).toEqual({ n: 1 });
    // existing accounts can still sign in from this IP
    await h.login("new0@example.com");
    // a day later the IP may create accounts again
    h.advance(DAY);
    await h.login("new5@example.com");
    expect(h.db.query("SELECT COUNT(*) AS n FROM users").get()).toEqual({ n: 6 });
  });
});

describe("L1: online code guessing across requests", () => {
  test("PoC guess: after 10 wrong codes per email in 24 h, codes stop working; links still work and reset it", async () => {
    h = startHarness({ env: { TRUST_PROXY: "1" } });
    let ip = 0;
    const fresh = async () => {
      h!.advance(31_000);
      const r = await magic(h!, "victim@example.com", `10.0.${ip >> 8}.${ip++ & 255}`);
      return { requestId: (await json<{ requestId: string }>(r)).requestId, mail: h!.mails.at(-1)! };
    };
    let evaluated = 0;
    for (let round = 0; round < 6; round++) {
      const { requestId, mail } = await fresh();
      const wrong = mail.code === "000000" ? "000001" : "000000";
      for (let i = 0; i < 5; i++) {
        await h.post("/v1/auth/verify", { requestId, code: wrong }, xff(`10.1.0.${ip++ & 255}`));
      }
      evaluated += 5;
    }
    expect(evaluated).toBeGreaterThan(MAX_FAILED_CODES_PER_EMAIL);
    expect((h.db.query("SELECT failures FROM verify_failures").get() as { failures: number }).failures).toBe(
      MAX_FAILED_CODES_PER_EMAIL,
    );
    // Even the RIGHT code is refused now.
    const locked = await fresh();
    expect((await h.post("/v1/auth/verify", { requestId: locked.requestId, code: locked.mail.code })).status).toBe(400);
    // The link (not guessable) still works and clears the lock.
    const token = locked.mail.link.split("token=")[1];
    expect((await h.post("/v1/auth/verify", { token })).status).toBe(200);
    const again = await fresh();
    expect((await h.post("/v1/auth/verify", { requestId: again.requestId, code: again.mail.code })).status).toBe(200);
  });

  test("the lock lifts after 24 h", async () => {
    h = startHarness({ env: { TRUST_PROXY: "1" } });
    for (let r = 0; r < 2; r++) {
      h.advance(31_000);
      const { requestId } = await json<{ requestId: string }>(await magic(h, "v@example.com", `10.2.0.${r}`));
      const code = h.mails.at(-1)!.code === "000000" ? "000001" : "000000";
      for (let i = 0; i < 5; i++) await h.post("/v1/auth/verify", { requestId, code }, xff(`10.3.0.${r * 5 + i}`));
    }
    h.advance(DAY);
    const { requestId } = await json<{ requestId: string }>(await magic(h, "v@example.com", "10.2.1.1"));
    expect((await h.post("/v1/auth/verify", { requestId, code: h.mails.at(-1)!.code }, xff("10.4.0.1"))).status).toBe(200);
  });
});

describe("L5: logging", () => {
  test("mail errors log only code/responseCode, never the error, address or code", async () => {
    const secretish = "victim@example.com 123456";
    const err = Object.assign(new Error(`550 rejected ${secretish}`), { code: "EENVELOPE", responseCode: 550 });
    expect(mailErrorSummary(err)).toBe("code=EENVELOPE responseCode=550");
    expect(mailErrorSummary("boom")).toBe("code=unknown responseCode=-");
    h = startHarness({
      mailer: {
        async sendLoginEmail() {
          throw err;
        },
      },
    });
    await magic(h, "victim@example.com");
    await Bun.sleep(10);
    expect(h.logs).toEqual(["login email failed: code=EENVELOPE responseCode=550"]);
  });

  test("unhandled errors log the class only in production (no message, no body)", async () => {
    h = startHarness({
      env: { NODE_ENV: "production", APP_URL: "https://app.example.com", CORS_ORIGINS: "https://app.example.com" },
    });
    // Force an internal error from inside a handler: a closed database.
    const { token } = await h.login("a@example.com");
    h.db.exec("DROP TABLE profiles");
    const res = await h.sync(token, {
      profile: { displayName: "secret-name", locale: "en", currentArcId: null, updatedAt: new Date(T0).toISOString() },
    });
    expect(res.status).toBe(500);
    expect(h.logs.join("\n")).not.toContain("secret-name");
    expect(h.logs.join("\n")).not.toContain("profiles");
    expect(h.logs.at(-1)).toMatch(/^unhandled error on POST \/v1\/sync: \w+/);
  });
});

describe("info items", () => {
  test("absolute session lifetime of 1 year, regardless of sliding renewal", async () => {
    h = startHarness();
    const { token } = await h.login("a@example.com");
    for (let d = 0; d < 364; d += 30) {
      h.advance(30 * DAY);
      if (h.clock.now - T0 < SESSION_MAX_AGE_MS) expect((await h.request("GET", "/v1/me", { token })).status).toBe(200);
    }
    h.clock.now = T0 + SESSION_MAX_AGE_MS;
    expect((await h.request("GET", "/v1/me", { token })).status).toBe(401);
  });

  test("DELETE /v1/me requires a sign-in from the last 10 minutes", async () => {
    h = startHarness();
    const old = await h.login("a@example.com");
    h.advance(10 * MINUTE + 1);
    const res = await h.request("DELETE", "/v1/me", { token: old.token });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "reauth_required" });
    expect(h.db.query("SELECT COUNT(*) AS n FROM users").get()).toEqual({ n: 1 });
    const fresh: SessionResponse = await h.login("a@example.com");
    expect((await h.request("DELETE", "/v1/me", { token: fresh.token })).status).toBe(204);
    expect(h.db.query("SELECT COUNT(*) AS n FROM users").get()).toEqual({ n: 0 });
  });

  test("Bearer scheme is case-insensitive", async () => {
    h = startHarness();
    const { token } = await h.login("a@example.com");
    for (const scheme of ["Bearer", "bearer", "BEARER", "bEaReR"]) {
      expect((await h.request("GET", "/v1/me", { headers: { Authorization: `${scheme} ${token}` } })).status).toBe(200);
    }
  });

  test("bodies between our limit and Bun's get our 413 with security + CORS headers", async () => {
    h = startHarness();
    const { token } = await h.login("a@example.com");
    const body = JSON.stringify({ pad: "x".repeat(1_000_000 + 10_000) });
    const res = await h.request("POST", "/v1/sync", {
      token,
      body,
      headers: { "Content-Type": "application/json", Origin: "https://app.example.com" },
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "payload_too_large" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.com");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
