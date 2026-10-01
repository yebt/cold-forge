import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { LIMITS } from "@cold-forge/sync";
import { APP_ORIGIN, startHarness, type Harness } from "./testing.ts";

let h: Harness;
beforeEach(() => {
  h = startHarness();
});
afterEach(() => h.stop());

describe("routing", () => {
  test("health", async () => {
    const res = await h.request("GET", "/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("unknown routes → 404 JSON (including old /api routes and prototype keys)", async () => {
    for (const path of ["/", "/api/arc", "/v1/nope", "/v1/health/", "/constructor", "/__proto__", "/v1/../etc/passwd"]) {
      const res = await h.request("GET", path);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
  });

  test("wrong method → 405 with Allow", async () => {
    const res = await h.request("PUT", "/v1/me");
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, DELETE, OPTIONS");
    expect((await h.request("GET", "/v1/sync")).status).toBe(405);
  });
});

describe("input handling", () => {
  test("oversized body → 413", async () => {
    const huge = JSON.stringify({ email: "a@b.co", pad: "x".repeat(LIMITS.maxBodyBytes) });
    const res = await h.post("/v1/auth/magic-link", null, { body: huge });
    expect(res.status).toBe(413);
    expect(h.mails).toHaveLength(0);
  });

  test("wrong content type → 415", async () => {
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
      const res = await h.post("/v1/auth/magic-link", null, {
        body: JSON.stringify({ email: "a@b.co" }),
        headers: { "Content-Type": type },
      });
      expect(res.status).toBe(415);
    }
    // fetch() labels a string body text/plain when no type is given
    const untyped = await h.request("POST", "/v1/auth/magic-link", { body: JSON.stringify({ email: "a@b.co" }) });
    expect(untyped.status).toBe(415);
    const missing = await h.request("POST", "/v1/auth/magic-link", { body: new Uint8Array([123, 125]) });
    expect(missing.status).toBe(415);
    expect(h.mails).toHaveLength(0);
  });

  test("malformed JSON → 400", async () => {
    for (const body of ["{", "", "nul", '{"email": "a@b.co",}']) {
      const res = await h.post("/v1/auth/magic-link", null, { body });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("invalid_json");
    }
  });

  test("non-object JSON bodies are rejected by the validators", async () => {
    const { token } = await h.login("a@example.com");
    for (const body of ["[]", "null", "42", '"x"']) {
      expect((await h.post("/v1/sync", null, { body, token })).status).toBe(400);
    }
  });

  test("authenticated POSTs also require JSON content type", async () => {
    const { token } = await h.login("a@example.com");
    const res = await h.request("POST", "/v1/auth/logout", { token, headers: { "Content-Type": "text/plain" } });
    expect(res.status).toBe(415);
    expect((await h.request("GET", "/v1/me", { token })).status).toBe(200);
  });

  test("errors never leak internals", async () => {
    h.db.exec("DROP TABLE check_ins"); // force an unexpected failure
    const { token } = await h.login("a@example.com");
    const res = await h.request("GET", "/v1/export", { token });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
    expect(h.logs.join()).toContain("GET /v1/export");
  });
});

describe("CORS", () => {
  test("allowed origin is echoed, with Vary", async () => {
    const res = await h.request("GET", "/v1/health", { headers: { Origin: APP_ORIGIN } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(APP_ORIGIN);
    expect(res.headers.get("Vary")).toContain("Origin");
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  test("Capacitor origin is allowed", async () => {
    const res = await h.request("GET", "/v1/health", { headers: { Origin: "capacitor://localhost" } });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("capacitor://localhost");
  });

  test("disallowed origin is refused and never echoed", async () => {
    for (const origin of ["https://evil.example", "null", `${APP_ORIGIN}.evil.com`, "https://app.example.co"]) {
      const res = await h.post("/v1/auth/magic-link", { email: "a@b.co" }, { headers: { Origin: origin } });
      expect(res.status).toBe(403);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(res.headers.get("Vary")).toContain("Origin");
    }
    expect(h.mails).toHaveLength(0);
  });

  test("no Origin (native app, curl) is fine", async () => {
    const res = await h.request("GET", "/v1/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  test("preflight: allowed", async () => {
    const res = await h.request("OPTIONS", "/v1/sync", {
      headers: {
        Origin: APP_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization, content-type",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(APP_ORIGIN);
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, DELETE, OPTIONS");
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type");
  });

  test("preflight: disallowed origin, method or header", async () => {
    const pre = (headers: Record<string, string>) =>
      h.request("OPTIONS", "/v1/sync", {
        headers: { Origin: APP_ORIGIN, "Access-Control-Request-Method": "POST", ...headers },
      });
    for (const res of [
      await pre({ Origin: "https://evil.example" }),
      await pre({ "Access-Control-Request-Method": "PUT" }),
      await pre({ "Access-Control-Request-Headers": "x-evil" }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.headers.get("Access-Control-Allow-Methods")).toBeNull();
    }
  });
});

describe("security headers", () => {
  test("present on success, error, 404 and auth responses", async () => {
    const responses = [
      await h.request("GET", "/v1/health"),
      await h.request("GET", "/v1/nope"),
      await h.request("GET", "/v1/me"),
      await h.post("/v1/auth/magic-link", { email: "a@b.co", locale: "en" }),
    ];
    for (const res of responses) {
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'; frame-ancestors 'none'");
      expect(res.headers.get("Content-Type")).toStartWith("application/json");
      expect(res.headers.get("Strict-Transport-Security")).toBeNull(); // not production
      expect(res.headers.get("Set-Cookie")).toBeNull();
    }
  });

  test("HSTS in production", async () => {
    h.stop();
    h = startHarness({
      env: {
        NODE_ENV: "production",
        SMTP_HOST: "smtp.example.com",
        MAIL_FROM: "login@example.com",
      },
    });
    const res = await h.request("GET", "/v1/health");
    expect(res.headers.get("Strict-Transport-Security")).toContain("max-age=");
  });
});
