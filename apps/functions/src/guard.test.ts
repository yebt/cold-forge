import { describe, expect, test } from "bun:test";
import { AdminError } from "./errors.ts";
import {
  assertLiveAdmin,
  isAllowlisted,
  normalizeEmail,
  parseEmailList,
  refuseAdminTarget,
  refuseSelf,
  requireAdmin,
  requireRecentLogin,
  type GuardConfig,
} from "./guard.ts";
import { adminCtx, NOW, nowSec, user } from "./testing/fakes.ts";

const config: GuardConfig = { allowedEmails: ["alice@example.com"] };
const alice = user("alice");
const bob = user("bob");

function error(fn: () => unknown): AdminError | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AdminError);
    return e as AdminError;
  }
  return undefined;
}
const code = (fn: () => unknown) => error(fn)?.code;

describe("requireAdmin: the allowlist is the admin role", () => {
  test("accepts a verified Google account in the allowlist and returns the actor", () => {
    expect(requireAdmin(adminCtx(alice), config)).toEqual({ uid: "alice", email: "alice@example.com", authTime: nowSec - 60 });
  });

  test("unauthenticated without auth", () => {
    expect(code(() => requireAdmin(undefined, config))).toBe("unauthenticated");
    expect(code(() => requireAdmin(null, config))).toBe("unauthenticated");
  });

  test("a verified Google user who is not in the allowlist is denied", () => {
    expect(code(() => requireAdmin(adminCtx(bob), config))).toBe("permission-denied");
  });

  test("the admin custom claim is ignored entirely", () => {
    expect(code(() => requireAdmin(adminCtx(bob, { admin: true }), config))).toBe("permission-denied");
    expect(requireAdmin(adminCtx(alice, { admin: false }), config).uid).toBe("alice");
  });

  test("allowlisted but unverified email is denied", () => {
    for (const email_verified of [false, "true", 1, undefined]) {
      expect(code(() => requireAdmin(adminCtx(alice, { email_verified }), config))).toBe("permission-denied");
    }
    expect(code(() => requireAdmin(adminCtx(alice, { email: undefined }), config))).toBe("permission-denied");
    expect(code(() => requireAdmin(adminCtx(alice, { email: "  " }), config))).toBe("permission-denied");
  });

  test("allowlisted but not a Google sign-in (password, custom, missing) is denied", () => {
    for (const firebase of [{ sign_in_provider: "password" }, { sign_in_provider: "custom" }, { sign_in_provider: "Google.com" }, undefined]) {
      expect(code(() => requireAdmin(adminCtx(alice, { firebase }), config))).toBe("permission-denied");
    }
  });

  test("email case and whitespace are normalized on both sides", () => {
    expect(requireAdmin(adminCtx(alice, { email: " Alice@Example.COM " }), config).email).toBe("alice@example.com");
    const messy = { allowedEmails: parseEmailList("  ALICE@example.com ,") };
    expect(requireAdmin(adminCtx(alice), messy).email).toBe("alice@example.com");
    expect(code(() => requireAdmin(adminCtx(alice, { email: "alice@example.co" }), messy))).toBe("permission-denied");
  });

  test("an empty allowlist denies everyone (fail closed)", () => {
    const err = error(() => requireAdmin(adminCtx(alice), { allowedEmails: [] }));
    expect([err?.code, err?.reason]).toEqual(["permission-denied", "allowlist-not-configured"]);
    expect(code(() => requireAdmin(adminCtx(alice, { admin: true }), { allowedEmails: [] }))).toBe("permission-denied");
  });
});

describe("assertLiveAdmin", () => {
  const actor = requireAdmin(adminCtx(alice), config);

  test("passes for the live, allowlisted account", () => {
    expect(() => assertLiveAdmin(actor, alice, config)).not.toThrow();
    expect(() => assertLiveAdmin(actor, { ...alice, email: "ALICE@example.com" }, config)).not.toThrow();
  });

  test("a stale token after the account was disabled is denied", () => {
    expect(code(() => assertLiveAdmin(actor, { ...alice, disabled: true }, config))).toBe("permission-denied");
  });

  test("rejects missing, mismatched, unverified or no-longer-allowlisted accounts", () => {
    expect(code(() => assertLiveAdmin(actor, null, config))).toBe("permission-denied");
    expect(code(() => assertLiveAdmin(actor, { ...alice, uid: "bob" }, config))).toBe("permission-denied");
    expect(code(() => assertLiveAdmin(actor, { ...alice, email: "other@example.com" }, config))).toBe("permission-denied");
    expect(code(() => assertLiveAdmin(actor, { ...alice, email: null }, config))).toBe("permission-denied");
    expect(code(() => assertLiveAdmin(actor, { ...alice, emailVerified: false }, config))).toBe("permission-denied");
    expect(code(() => assertLiveAdmin(actor, alice, { allowedEmails: ["carol@example.com"] }))).toBe("permission-denied");
  });

  test("requires tokensValidAfterTime <= auth_time (revoked sessions are refused)", () => {
    const err = error(() => assertLiveAdmin(actor, { ...alice, tokensValidAfter: NOW.toISOString() }, config));
    expect([err?.code, err?.reason]).toEqual(["unauthenticated", "session-revoked"]);
    const atAuthTime = new Date(actor.authTime * 1000).toISOString();
    expect(() => assertLiveAdmin(actor, { ...alice, tokensValidAfter: atAuthTime }, config)).not.toThrow();
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
  expect(error(() => refuseSelf(actor, "a", "delete"))?.reason).toBe("self-action");
  expect(() => refuseSelf(actor, "b", "delete")).not.toThrow();
});

test("refuseAdminTarget refuses accounts whose email is in the allowlist", () => {
  expect(error(() => refuseAdminTarget({ ...alice, email: " ALICE@example.com" }, config, "deleted"))?.reason).toBe("target-is-admin");
  // Verification doesn't matter for protection: the email alone is enough.
  expect(error(() => refuseAdminTarget({ ...alice, emailVerified: false }, config, "disabled"))?.reason).toBe("target-is-admin");
  expect(() => refuseAdminTarget(bob, config, "deleted")).not.toThrow();
  expect(() => refuseAdminTarget({ ...bob, email: null }, config, "deleted")).not.toThrow();
});

test("normalizeEmail / isAllowlisted", () => {
  expect(normalizeEmail("  A@B.Co ")).toBe("a@b.co");
  expect(isAllowlisted(" Alice@EXAMPLE.com", config.allowedEmails)).toBe(true);
  expect(isAllowlisted(null, config.allowedEmails)).toBe(false);
  expect(isAllowlisted("", [""])).toBe(false);
});

test("parseEmailList trims, lower-cases and de-duplicates", () => {
  expect(parseEmailList(undefined)).toEqual([]);
  expect(parseEmailList("")).toEqual([]);
  expect(parseEmailList(" A@x.co, b@y.co\nc@z.co ,a@X.CO")).toEqual(["a@x.co", "b@y.co", "c@z.co"]);
});
