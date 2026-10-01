import { beforeEach, describe, expect, test } from "bun:test";
import { AdminError } from "./errors.ts";
import { createAdminService, mapLimit, toUserRow } from "./service.ts";
import { adminCtx, FakeAuth, FakeData, NOW, nowSec, user } from "./testing/fakes.ts";
import type { AuthUser } from "./ports.ts";

let auth: FakeAuth;
let data: FakeData;
let svc: ReturnType<typeof createAdminService>;
let alice: AuthUser;
let bob: AuthUser;
let carol: AuthUser;

/** alice and carol are admins because their emails are in the allowlist (messy on purpose). */
const ALLOWED = [" Alice@Example.com", "CAROL@example.com "];

beforeEach(() => {
  alice = user("alice");
  bob = user("bob", { createdAt: "2026-09-28T00:00:00.000Z" });
  carol = user("carol", { createdAt: "2026-09-10T00:00:00.000Z" });
  auth = new FakeAuth([alice, bob, carol]);
  data = new FakeData();
  data.counts.set("bob", { arcs: 1, habits: 4, checkIns: 30 });
  data.profiles.set("bob", { displayName: "Bob", locale: "es", currentArcId: "arc1", createdAt: null, updatedAt: "2026-09-30T00:00:00.000Z" });
  svc = createAdminService({ auth, data, now: () => NOW, config: { allowedEmails: ALLOWED } });
});

async function failure(promise: Promise<unknown>): Promise<AdminError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AdminError) return error;
    throw error;
  }
  throw new Error("expected AdminError");
}

describe("authorization", () => {
  test("a verified Google user outside the allowlist is refused before any I/O", async () => {
    const err = await failure(svc.listUsers(adminCtx(bob), {}));
    expect(err.code).toBe("permission-denied");
    expect(data.rate.size).toBe(0);
  });

  test("the admin claim grants nothing", async () => {
    expect((await failure(svc.stats(adminCtx(bob, { admin: true }), {}))).code).toBe("permission-denied");
  });

  test("allowlisted but unverified, or not a Google sign-in, is refused", async () => {
    expect((await failure(svc.stats(adminCtx(alice, { email_verified: false }), {}))).code).toBe("permission-denied");
    expect((await failure(svc.stats(adminCtx(alice, { firebase: { sign_in_provider: "password" } }), {}))).code).toBe("permission-denied");
    expect(data.rate.size).toBe(0);
  });

  test("email case and whitespace don't matter", async () => {
    expect((await svc.whoAmI(adminCtx(alice, { email: "ALICE@example.COM" }), {})).email).toBe("alice@example.com");
  });

  test("a stale token is refused once the account is disabled", async () => {
    auth.users.set("alice", { ...alice, disabled: true });
    expect((await failure(svc.stats(adminCtx(alice), {}))).code).toBe("permission-denied");
  });

  test("a token is refused once the live account's email no longer matches or is unverified", async () => {
    auth.users.set("alice", { ...alice, email: "alice@elsewhere.com" });
    expect((await failure(svc.stats(adminCtx(alice), {}))).code).toBe("permission-denied");
    auth.users.set("alice", { ...alice, emailVerified: false });
    expect((await failure(svc.stats(adminCtx(alice), {}))).code).toBe("permission-denied");
  });

  test("revoked sessions are refused", async () => {
    await auth.revokeRefreshTokens("alice");
    const err = await failure(svc.stats(adminCtx(alice, { auth_time: nowSec - 3600 }), {}));
    expect(err.code).toBe("unauthenticated");
    expect(err.reason).toBe("session-revoked");
  });

  test("an empty allowlist refuses everyone (fail closed)", async () => {
    for (const allowedEmails of [[], [" ", ""]]) {
      const closed = createAdminService({ auth, data, now: () => NOW, config: { allowedEmails } });
      const err = await failure(closed.stats(adminCtx(alice), {}));
      expect([err.code, err.reason]).toEqual(["permission-denied", "allowlist-not-configured"]);
    }
    const defaults = createAdminService({ auth, data, now: () => NOW });
    expect((await failure(defaults.whoAmI(adminCtx(alice), {}))).code).toBe("permission-denied");
    expect(data.rate.size).toBe(0); // refused before any I/O
  });

  test("rate limits writes per admin", async () => {
    const ctx = adminCtx(alice);
    for (let i = 0; i < 10; i++) {
      await svc.setDisabled(ctx, { uid: "bob", disabled: i % 2 === 0, reason: "testing" });
    }
    const err = await failure(svc.setDisabled(ctx, { uid: "bob", disabled: true, reason: "testing" }));
    expect(err.code).toBe("resource-exhausted");
    // Reads have their own bucket.
    await svc.stats(ctx, {});
  });

  test("validation runs after authorization", async () => {
    expect((await failure(svc.getUser(undefined, { uid: "../x" }))).code).toBe("unauthenticated");
    expect((await failure(svc.getUser(adminCtx(alice), { uid: "../x" }))).code).toBe("invalid-argument");
  });
});

describe("L5: audit of refusals and sensitive reads", () => {
  test("rate-limited mutations are audited as refused; rate-limited list pages are not", async () => {
    const ctx = adminCtx(alice);
    for (let i = 0; i < 10; i++) await svc.setDisabled(ctx, { uid: "bob", disabled: i % 2 === 0, reason: "testing" });
    const before = data.audit.length;
    await failure(svc.setDisabled(ctx, { uid: "bob", disabled: true, reason: "testing" }));
    expect(data.audit.length).toBe(before + 1);
    expect(data.audit[0]).toMatchObject({ action: "user.disable", targetUid: "bob", outcome: "refused", code: "rate-limited" });
    for (let i = 0; i < 60; i++) await svc.listUsers(ctx, {});
    const n = data.audit.length;
    expect((await failure(svc.listUsers(ctx, {}))).reason).toBe("rate-limited");
    expect(data.audit.length).toBe(n);
  });

  test("viewing one account is audited (user.view); list pages are not", async () => {
    await svc.listUsers(adminCtx(alice), {});
    expect(data.audit).toEqual([]);
    await svc.getUser(adminCtx(alice), { uid: "bob" });
    expect(data.audit[0]).toMatchObject({ actorUid: "alice", action: "user.view", targetUid: "bob", targetEmail: "bob@example.com", outcome: "ok" });
  });

});

describe("whoAmI", () => {
  test("returns the normalized email for an admin, and validates input", async () => {
    expect(await svc.whoAmI(adminCtx(carol), undefined)).toEqual({ email: "carol@example.com", isAdmin: true });
    expect((await failure(svc.whoAmI(adminCtx(alice), { x: 1 }))).code).toBe("invalid-argument");
    expect(data.audit).toEqual([]);
  });
  test("non-admins get permission-denied", async () => {
    expect((await failure(svc.whoAmI(adminCtx(bob), {}))).code).toBe("permission-denied");
    expect((await failure(svc.whoAmI(undefined, {}))).code).toBe("unauthenticated");
  });
});

describe("listUsers", () => {
  test("pages with per-user counts", async () => {
    const res = await svc.listUsers(adminCtx(alice), { pageSize: 2 });
    expect(res.mode).toBe("page");
    expect(res.users.map((u) => u.uid)).toEqual(["alice", "bob"]);
    expect(res.users[1]?.counts).toEqual({ arcs: 1, habits: 4, checkIns: 30 });
    expect(res.nextPageToken).toBe("p2");
    const next = await svc.listUsers(adminCtx(alice), { pageSize: 2, pageToken: res.nextPageToken });
    expect(next.users.map((u) => u.uid)).toEqual(["carol"]);
    expect(next.nextPageToken).toBeNull();
  });

  test("exact email lookup", async () => {
    const res = await svc.listUsers(adminCtx(alice), { query: "BOB@example.com" });
    expect(res.mode).toBe("exact");
    expect(res.users.map((u) => u.uid)).toEqual(["bob"]);
  });

  test("substring search over email and name", async () => {
    const res = await svc.listUsers(adminCtx(alice), { query: "car" });
    expect(res.mode).toBe("search");
    expect(res.users.map((u) => u.uid)).toEqual(["carol"]);
    expect(res.scanned).toBe(3);
  });

  test("never leaks non-https photo URLs", () => {
    expect(toUserRow(user("x", { photoURL: "javascript:alert(1)" }), null, []).photoURL).toBeNull();
    expect(toUserRow(user("x", { photoURL: "https://lh3.googleusercontent.com/a" }), null, []).photoURL).toBe("https://lh3.googleusercontent.com/a");
  });

  test("isAdmin is computed server-side from the allowlist", async () => {
    const res = await svc.listUsers(adminCtx(alice), {});
    expect(res.users.map((u) => [u.uid, u.isAdmin])).toEqual([
      ["alice", true],
      ["bob", false],
      ["carol", true],
    ]);
  });
});

describe("getUser", () => {
  test("returns profile and counts", async () => {
    const res = await svc.getUser(adminCtx(alice), { uid: "bob" });
    expect(res.profile?.locale).toBe("es");
    expect(res.user.counts?.checkIns).toBe(30);
  });
  test("not-found", async () => {
    expect((await failure(svc.getUser(adminCtx(alice), { uid: "nobody" }))).code).toBe("not-found");
  });
});

describe("setDisabled", () => {
  test("disables, revokes and audits", async () => {
    const res = await svc.setDisabled(adminCtx(alice), { uid: "bob", disabled: true, reason: "abuse" });
    expect(res.user?.disabled).toBe(true);
    expect(auth.calls).toEqual(["setDisabled:bob:true", "revoke:bob"]);
    expect(data.audit[0]).toMatchObject({ actorUid: "alice", action: "user.disable", targetUid: "bob", reason: "abuse", outcome: "ok", code: null });
  });
  test("M1: disabling writes blocked/{uid} (Firestore access ends at once); enabling lifts only that block", async () => {
    await svc.setDisabled(adminCtx(alice), { uid: "bob", disabled: true, reason: "abuse" });
    expect(data.blocked.get("bob")).toBe("disabled");
    expect(data.calls).toEqual(["block:bob:disabled"]);
    await svc.setDisabled(adminCtx(alice), { uid: "bob", disabled: false, reason: "appeal ok" });
    expect(data.blocked.has("bob")).toBe(false);
    // A quota block survives re-enabling (and isn't downgraded by a later disable).
    data.blocked.set("bob", "quota");
    await svc.setDisabled(adminCtx(alice), { uid: "bob", disabled: true, reason: "abuse again" });
    expect(data.blocked.get("bob")).toBe("quota");
    await svc.setDisabled(adminCtx(alice), { uid: "bob", disabled: false, reason: "appeal ok" });
    expect(data.blocked.get("bob")).toBe("quota");
  });
  test("re-enabling an allowlisted account is allowed (only disable/delete are refused)", async () => {
    auth.users.set("carol", { ...carol, disabled: true });
    const res = await svc.setDisabled(adminCtx(alice), { uid: "carol", disabled: false, reason: "restore" });
    expect(res.user).toMatchObject({ disabled: false, isAdmin: true });
  });
  test("enabling does not revoke", async () => {
    await svc.setDisabled(adminCtx(alice), { uid: "bob", disabled: false, reason: "appeal ok" });
    expect(auth.calls).toEqual(["setDisabled:bob:false"]);
    expect(data.audit[0]?.action).toBe("user.enable");
  });
  test("L5: refuses self and allowlisted accounts, and audits the refusals", async () => {
    expect((await failure(svc.setDisabled(adminCtx(alice), { uid: "alice", disabled: true, reason: "oops" }))).reason).toBe("self-action");
    expect((await failure(svc.setDisabled(adminCtx(alice), { uid: "carol", disabled: true, reason: "oops" }))).reason).toBe("target-is-admin");
    expect(auth.calls).toEqual([]);
    expect(data.blocked.size).toBe(0);
    expect(data.audit.map(({ action, targetUid, targetEmail, outcome, code }) => ({ action, targetUid, targetEmail, outcome, code }))).toEqual([
      { action: "user.disable", targetUid: "carol", targetEmail: "carol@example.com", outcome: "refused", code: "target-is-admin" },
      { action: "user.disable", targetUid: "alice", targetEmail: null, outcome: "refused", code: "self-action" },
    ]);
  });
});

describe("deleteUser", () => {
  test("requires the typed email and deletes data then account", async () => {
    const err = await failure(svc.deleteUser(adminCtx(alice), { uid: "bob", confirm: "carol@example.com" }));
    expect(err.reason).toBe("confirm-mismatch");
    expect(auth.users.has("bob")).toBe(true);

    expect(data.audit[0]).toMatchObject({ action: "user.delete", targetUid: "bob", outcome: "refused", code: "confirm-mismatch" });

    await svc.deleteUser(adminCtx(alice), { uid: "bob", confirm: "Bob@Example.com" });
    expect(auth.calls).toEqual(["setDisabled:bob:true", "revoke:bob", "deleteUser:bob"]);
    // M1: blocked first, so the rules refuse the uid while its data is being removed.
    expect(data.calls).toEqual(["block:bob:deleted", "deleteData:bob"]);
    expect(data.blocked.get("bob")).toBe("deleted");
    expect(auth.users.has("bob")).toBe(false);
    expect(data.audit[0]).toMatchObject({ action: "user.delete", targetEmail: "bob@example.com", outcome: "ok" });
  });

  test("uses the uid as confirmation when there is no email", async () => {
    auth.users.set("bob", { ...bob, email: null });
    await svc.deleteUser(adminCtx(alice), { uid: "bob", confirm: "bob" });
    expect(auth.users.has("bob")).toBe(false);
  });

  test("refuses self, allowlisted accounts and stale sign-ins", async () => {
    expect((await failure(svc.deleteUser(adminCtx(alice), { uid: "alice", confirm: "alice@example.com" }))).reason).toBe("self-action");
    expect((await failure(svc.deleteUser(adminCtx(alice), { uid: "carol", confirm: "carol@example.com" }))).reason).toBe("target-is-admin");
    const stale = adminCtx(alice, { auth_time: nowSec - 3 * 3600 });
    expect((await failure(svc.deleteUser(stale, { uid: "bob", confirm: "bob@example.com" }))).reason).toBe("recent-login-required");
    expect(auth.users.has("bob")).toBe(true);
    expect(data.audit.map((a) => [a.outcome, a.code])).toEqual([
      ["refused", "recent-login-required"],
      ["refused", "target-is-admin"],
      ["refused", "self-action"],
    ]);
  });

  test("audits failures and leaves the account disabled", async () => {
    data.failDeleteData = true;
    await expect(svc.deleteUser(adminCtx(alice), { uid: "bob", confirm: "bob@example.com" })).rejects.toThrow("boom");
    expect(data.audit[0]).toMatchObject({ action: "user.delete", outcome: "error" });
    expect(auth.users.get("bob")?.disabled).toBe(true);
  });
});

describe("stats and audit", () => {
  test("stats", async () => {
    const res = await svc.stats(adminCtx(alice), undefined);
    expect(res).toMatchObject({
      totalUsers: 3,
      usersCapped: false,
      admins: 2,
      disabledUsers: 0,
      signups7d: 1,
      signups30d: 2,
      active7d: 1,
      totals: { arcs: 1, habits: 4, checkIns: 30 },
    });
  });

  test("audit log pages", async () => {
    for (let i = 0; i < 3; i++) await svc.setDisabled(adminCtx(alice), { uid: "bob", disabled: true, reason: `r${i}x` });
    const first = await svc.listAuditLog(adminCtx(alice), { pageSize: 2 });
    expect(first.entries.map((e) => e.reason)).toEqual(["r2x", "r1x"]);
    const second = await svc.listAuditLog(adminCtx(alice), { pageSize: 2, pageToken: first.nextPageToken });
    expect(second.entries.map((e) => e.reason)).toEqual(["r0x"]);
    expect(second.nextPageToken).toBeNull();
  });
});

test("mapLimit preserves order and bounds concurrency", async () => {
  let active = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
    active++;
    peak = Math.max(peak, active);
    await Bun.sleep(1);
    active--;
    return n * 2;
  });
  expect(out).toEqual([2, 4, 6, 8, 10, 12]);
  expect(peak).toBe(2);
});
