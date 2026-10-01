import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SessionResponse } from "@cold-forge/sync";
import { DAY, MINUTE } from "./rate-limit.ts";
import { APP_ORIGIN, startHarness, type Harness } from "./testing.ts";

let h: Harness;
beforeEach(() => {
  h = startHarness();
});
afterEach(() => h.stop());

const magic = (email = "yahir@example.com", locale = "es") => h.post("/v1/auth/magic-link", { email, locale });
const requestId = async (res: Response) => ((await res.json()) as { requestId: string }).requestId;
const verifyCode = (id: string, code: string) => h.post("/v1/auth/verify", { requestId: id, code });
const wrong = (code: string) => (code === "000000" ? "000001" : "000000");

describe("magic link login", () => {
  test("full flow by code creates the user lazily and returns a session", async () => {
    const res = await magic(" Yahir@Example.com ");
    expect(res.status).toBe(202);
    const id = await requestId(res);
    expect(h.db.query("SELECT COUNT(*) AS n FROM users").get()).toEqual({ n: 0 }); // not created yet

    const mail = h.mails[0]!;
    expect(mail.to).toBe("yahir@example.com");
    expect(mail.locale).toBe("es");
    expect(mail.code).toMatch(/^\d{6}$/);
    expect(mail.link).toStartWith(`${APP_ORIGIN}/#/auth?token=`);

    const ok = await verifyCode(id, mail.code);
    expect(ok.status).toBe(200);
    const session = (await ok.json()) as SessionResponse;
    expect(session.user.email).toBe("yahir@example.com");
    expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(session.expiresAt) - h.clock.now).toBe(60 * DAY);

    const me = await h.request("GET", "/v1/me", { token: session.token });
    expect(await me.json()).toEqual({ user: session.user });
  });

  test("full flow by link token", async () => {
    await magic();
    const token = new URL(h.mails[0]!.link.replace("#/auth", "")).searchParams.get("token")!;
    const ok = await h.post("/v1/auth/verify", { token });
    expect(ok.status).toBe(200);
    // the link is single use
    expect((await h.post("/v1/auth/verify", { token })).status).toBe(400);
  });

  test("same user on second login", async () => {
    const a = await h.login("a@example.com");
    const b = await h.login("A@EXAMPLE.com");
    expect(b.user.id).toBe(a.user.id);
    expect(b.token).not.toBe(a.token);
  });

  test("nothing secret is stored in plaintext", async () => {
    const id = await requestId(await magic());
    const { code, link } = h.mails[0]!;
    const token = link.split("token=")[1]!;
    const dump = JSON.stringify(h.db.query("SELECT * FROM login_requests").all(), (_, v) =>
      v instanceof Uint8Array ? Buffer.from(v).toString("hex") + Buffer.from(v).toString("utf8") : v,
    );
    expect(dump).not.toContain(token);
    expect(dump).not.toContain(`"${code}"`);
    const session = (await (await verifyCode(id, code)).json()) as SessionResponse;
    const sessions = JSON.stringify(h.db.query("SELECT * FROM sessions").all(), (_, v) =>
      v instanceof Uint8Array ? Buffer.from(v).toString("utf8") : v,
    );
    expect(sessions).not.toContain(session.token);
  });

  test("no account enumeration: identical responses for new and existing users", async () => {
    await h.login("existing@example.com");
    const a = await magic("existing@example.com");
    const b = await magic("nobody@example.com");
    expect(a.status).toBe(b.status);
    expect([...a.headers.keys()].sort()).toEqual([...b.headers.keys()].sort());
    const [ja, jb] = [(await a.json()) as object, (await b.json()) as object];
    expect(Object.keys(ja)).toEqual(Object.keys(jb));
  });

  test("invalid email → 400, does not send", async () => {
    expect((await magic("not-an-email")).status).toBe(400);
    expect((await magic("a@b.com\r\nBcc: x@y.com")).status).toBe(400);
    expect(h.mails).toHaveLength(0);
  });

  test("expired code", async () => {
    const id = await requestId(await magic());
    h.advance(15 * MINUTE);
    const res = await verifyCode(id, h.mails[0]!.code);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_or_expired" });
  });

  test("reused code, and the code kills the link (single use)", async () => {
    const id = await requestId(await magic());
    const { code, link } = h.mails[0]!;
    expect((await verifyCode(id, code)).status).toBe(200);
    expect((await verifyCode(id, code)).status).toBe(400);
    expect((await h.post("/v1/auth/verify", { token: link.split("token=")[1] })).status).toBe(400);
  });

  test("5 wrong attempts kill the request", async () => {
    const id = await requestId(await magic());
    const { code } = h.mails[0]!;
    for (let i = 0; i < 5; i++) {
      const res = await verifyCode(id, wrong(code));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_or_expired" });
    }
    expect((await verifyCode(id, code)).status).toBe(400);
    expect(h.db.query("SELECT COUNT(*) AS n FROM login_requests").get()).toEqual({ n: 0 });
  });

  test("4 wrong attempts then the right code still works", async () => {
    const id = await requestId(await magic());
    const { code } = h.mails[0]!;
    for (let i = 0; i < 4; i++) await verifyCode(id, wrong(code));
    expect((await verifyCode(id, code)).status).toBe(200);
  });

  test("a new request does NOT invalidate the older one; a sign-in consumes all of them", async () => {
    const first = await requestId(await magic());
    const firstMail = h.mails[0]!;
    h.advance(31_000); // per-email cooldown
    const second = await requestId(await magic());
    expect(h.mails).toHaveLength(2);
    expect((await verifyCode(first, firstMail.code)).status).toBe(200);
    // single sign-in consumed every pending request for the email
    expect((await verifyCode(second, h.mails[1]!.code)).status).toBe(400);
    expect((await h.post("/v1/auth/verify", { token: firstMail.link.split("token=")[1] })).status).toBe(400);
    expect(h.db.query("SELECT COUNT(*) AS n FROM login_requests").get()).toEqual({ n: 0 });
  });

  test("a code only works with its own request id", async () => {
    const a = await requestId(await magic("a@example.com"));
    await magic("b@example.com");
    expect((await verifyCode(a, h.mails[1]!.code)).status).toBe(400);
  });

  test("malformed verify bodies get the same generic error", async () => {
    for (const body of [{}, { requestId: "x", code: "1" }, { token: "short" }, { token: 5 }]) {
      const res = await h.post("/v1/auth/verify", body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_or_expired" });
    }
  });

  test("expired login requests are cleaned up", async () => {
    await magic();
    h.advance(16 * MINUTE);
    expect(h.app.cleanup()).toBe(1);
  });
});

describe("rate limits", () => {
  test("per (email, IP): silently stops sending but still answers 202 with the same shape", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await magic("victim@example.com")).status).toBe(202);
      h.advance(31_000); // per-email cooldown
    }
    const limited = await magic("victim@example.com");
    expect(limited.status).toBe(202);
    expect(Object.keys((await limited.json()) as object)).toEqual(["requestId"]);
    expect(h.mails).toHaveLength(3);
    // after the window, sending resumes
    h.advance(15 * MINUTE);
    expect((await magic("victim@example.com")).status).toBe(202);
    expect(h.mails).toHaveLength(4);
  });

  test("per email: 30 s cooldown between sends (silent)", async () => {
    await magic("cool@example.com");
    h.advance(29_000);
    await magic("cool@example.com");
    expect(h.mails).toHaveLength(1);
    h.advance(1_001);
    await magic("cool@example.com");
    expect(h.mails).toHaveLength(2);
  });

  test("per email: 20 per day, shared by all IPs", async () => {
    const h2 = startHarness({ env: { TRUST_PROXY: "1" } });
    try {
      for (let i = 0; i < 25; i++) {
        await h2.post("/v1/auth/magic-link", { email: "daily@example.com" }, { headers: { "X-Forwarded-For": `10.9.0.${i}` } });
        h2.advance(31_000);
      }
      expect(h2.mails).toHaveLength(20);
    } finally {
      h2.stop();
    }
  });

  test("per IP: 429 after 10 magic links in 15 min", async () => {
    for (let i = 0; i < 10; i++) expect((await magic(`u${i}@example.com`)).status).toBe(202);
    const res = await magic("u10@example.com");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
  });

  test("verify: 429 after 20 attempts per IP in 15 min", async () => {
    for (let i = 0; i < 20; i++) {
      expect((await h.post("/v1/auth/verify", { requestId: crypto.randomUUID(), code: "123456" })).status).toBe(400);
    }
    expect((await h.post("/v1/auth/verify", { requestId: crypto.randomUUID(), code: "123456" })).status).toBe(429);
  });

  test("per user: 429 after 120 authenticated requests per minute", async () => {
    const { token } = await h.login("busy@example.com");
    for (let i = 0; i < 120; i++) expect((await h.request("GET", "/v1/me", { token })).status).toBe(200);
    expect((await h.request("GET", "/v1/me", { token })).status).toBe(429);
    h.advance(MINUTE);
    expect((await h.request("GET", "/v1/me", { token })).status).toBe(200);
  });
});

describe("sessions", () => {
  test("bearer required: missing, malformed, unknown", async () => {
    for (const headers of <Record<string, string>[]>[
      {},
      { Authorization: "Bearer" },
      { Authorization: "Basic dXNlcjpwYXNz" },
      { Authorization: `Bearer ${"A".repeat(43)}` },
      { Cookie: "session=whatever" },
    ]) {
      const res = await h.request("GET", "/v1/me", { headers });
      expect(res.status).toBe(401);
      expect(res.headers.get("WWW-Authenticate")).toContain("Bearer");
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
  });

  test("tokens expire after 60 days without use", async () => {
    const { token } = await h.login("a@example.com");
    h.advance(60 * DAY);
    expect((await h.request("GET", "/v1/me", { token })).status).toBe(401);
  });

  test("sliding renewal keeps active sessions alive", async () => {
    const { token } = await h.login("a@example.com");
    h.advance(50 * DAY);
    expect((await h.request("GET", "/v1/me", { token })).status).toBe(200);
    h.advance(50 * DAY); // 100 days after login, 50 after last use
    expect((await h.request("GET", "/v1/me", { token })).status).toBe(200);
  });

  test("renewal is written at most once a day", async () => {
    const { token } = await h.login("a@example.com");
    const read = () => h.db.query("SELECT last_used_at, expires_at FROM sessions").get();
    const before = read();
    h.advance(DAY - 1);
    await h.request("GET", "/v1/me", { token });
    expect(read()).toEqual(before);
    h.advance(1);
    await h.request("GET", "/v1/me", { token });
    expect(read()).not.toEqual(before);
  });

  test("logout revokes only the current session, immediately", async () => {
    const a = await h.login("a@example.com");
    const b = await h.login("a@example.com");
    expect((await h.post("/v1/auth/logout", {}, { token: a.token })).status).toBe(204);
    expect((await h.request("GET", "/v1/me", { token: a.token })).status).toBe(401);
    expect((await h.request("GET", "/v1/me", { token: b.token })).status).toBe(200);
  });

  test("logout-all revokes every session of the user, not of others", async () => {
    const a = await h.login("a@example.com");
    const b = await h.login("a@example.com");
    const other = await h.login("other@example.com");
    expect((await h.post("/v1/auth/logout-all", {}, { token: a.token })).status).toBe(204);
    expect((await h.request("GET", "/v1/me", { token: a.token })).status).toBe(401);
    expect((await h.request("GET", "/v1/me", { token: b.token })).status).toBe(401);
    expect((await h.request("GET", "/v1/me", { token: other.token })).status).toBe(200);
  });

  test("expired sessions are cleaned up", async () => {
    await h.login("a@example.com");
    h.advance(61 * DAY);
    expect(h.app.cleanup()).toBe(1);
  });
});
