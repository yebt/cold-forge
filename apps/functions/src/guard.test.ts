import { describe, expect, test } from "bun:test";
import { AdminError } from "./errors.ts";
import { assertLiveAdmin, parseEmailList, refuseSelf, requireAdmin, requireRecentLogin, type GuardConfig } from "./guard.ts";
import { adminCtx, NOW, nowSec, user } from "./testing/fakes.ts";

const config: GuardConfig = { allowedEmails: [], allowAnyAdmin: true, requireGoogleProvider: true };
const alice = user("alice", { admin: true });

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AdminError);
    return (error as AdminError).code;
  }
  return undefined;
}

describe("requireAdmin", () => {
  test("accepts a verified Google admin and returns the actor", () => {
    expect(requireAdmin(adminCtx(alice), config)).toEqual({ uid: "alice", email: "alice@example.com", authTime: nowSec - 60 });
  });

  test("unauthenticated without auth", () => {
    expect(code(() => requireAdmin(undefined, config))).toBe("unauthenticated");
    expect(code(() => requireAdmin(null, config))).toBe("unauthenticated");
  });

  test("admin claim must be exactly true", () => {
    for (const admin of [undefined, false, "true", 1, {}]) {
      expect(code(() => requireAdmin(adminCtx(alice, { admin }), config))).toBe("permission-denied");
    }
  });

  test("requires a verified email", () => {
    expect(code(() => requireAdmin(adminCtx(alice, { email_verified: false }), config))).toBe("permission-denied");
    expect(code(() => requireAdmin(adminCtx(alice, { email_verified: "true" }), config))).toBe("permission-denied");
    expect(code(() => requireAdmin(adminCtx(alice, { email: undefined }), config))).toBe("permission-denied");
    expect(code(() => requireAdmin(adminCtx(alice, { email: "" }), config))).toBe("permission-denied");
  });

  test("requires Google sign-in unless disabled", () => {
    const ctx = adminCtx(alice, { firebase: { sign_in_provider: "custom" } });
    expect(code(() => requireAdmin(ctx, config))).toBe("permission-denied");
    expect(code(() => requireAdmin(adminCtx(alice, { firebase: undefined }), config))).toBe("permission-denied");
    expect(requireAdmin(ctx, { ...config, requireGoogleProvider: false }).uid).toBe("alice");
  });

  test("L6: an empty allowlist fails closed unless ADMIN_ALLOW_ANY_ADMIN is explicit", () => {
    const closed = { ...config, allowAnyAdmin: false };
    let err: unknown;
    try {
      requireAdmin(adminCtx(alice), closed);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AdminError);
    expect((err as AdminError).code).toBe("permission-denied");
    expect((err as AdminError).reason).toBe("allowlist-not-configured");
    expect(requireAdmin(adminCtx(alice), { ...closed, allowedEmails: ["alice@example.com"] }).uid).toBe("alice");
    // Non-admins still get the plain refusal (no hint about the configuration).
    expect(code(() => requireAdmin(adminCtx(alice, { admin: false }), closed))).toBe("permission-denied");
  });

  test("enforces the email allowlist case-insensitively (even with allowAnyAdmin)", () => {
    const allow = { ...config, allowedEmails: ["alice@example.com"] };
    expect(requireAdmin(adminCtx(alice, { email: "Alice@Example.com" }), allow).email).toBe("alice@example.com");
    expect(code(() => requireAdmin(adminCtx(alice, { email: "mallory@example.com" }), allow))).toBe("permission-denied");
  });
});

describe("assertLiveAdmin", () => {
  const actor = requireAdmin(adminCtx(alice), config);

  test("passes for the live admin", () => {
    expect(() => assertLiveAdmin(actor, alice)).not.toThrow();
  });
  test("rejects missing, disabled, demoted or mismatched accounts", () => {
    expect(code(() => assertLiveAdmin(actor, null))).toBe("permission-denied");
    expect(code(() => assertLiveAdmin(actor, { ...alice, disabled: true }))).toBe("permission-denied");
    expect(code(() => assertLiveAdmin(actor, { ...alice, admin: false }))).toBe("permission-denied");
    expect(code(() => assertLiveAdmin(actor, { ...alice, email: "other@example.com" }))).toBe("permission-denied");
    expect(code(() => assertLiveAdmin(actor, { ...alice, uid: "bob" }))).toBe("permission-denied");
  });
  test("rejects sessions older than a token revocation", () => {
    expect(code(() => assertLiveAdmin(actor, { ...alice, tokensValidAfter: NOW.toISOString() }))).toBe("unauthenticated");
  });
});

test("requireRecentLogin", () => {
  const fresh = { uid: "a", email: "a@x.co", authTime: nowSec - 60 };
  expect(() => requireRecentLogin(fresh, NOW, 1800)).not.toThrow();
  expect(code(() => requireRecentLogin({ ...fresh, authTime: nowSec - 1801 }, NOW, 1800))).toBe("failed-precondition");
  expect(code(() => requireRecentLogin({ ...fresh, authTime: 0 }, NOW, 1800))).toBe("failed-precondition");
});

test("refuseSelf", () => {
  const actor = { uid: "a", email: "a@x.co", authTime: 1 };
  expect(code(() => refuseSelf(actor, "a", "delete"))).toBe("failed-precondition");
  expect(() => refuseSelf(actor, "b", "delete")).not.toThrow();
});

test("parseEmailList", () => {
  expect(parseEmailList(undefined)).toEqual([]);
  expect(parseEmailList(" A@x.co, b@y.co\nc@z.co ,")).toEqual(["a@x.co", "b@y.co", "c@z.co"]);
});
