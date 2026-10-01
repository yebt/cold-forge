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

beforeEach(() => {
  alice = user("alice", { admin: true });
  bob = user("bob", { createdAt: "2026-09-28T00:00:00.000Z" });
  carol = user("carol", { admin: true, createdAt: "2026-09-10T00:00:00.000Z" });
  auth = new FakeAuth([alice, bob, carol]);
  data = new FakeData();
  data.counts.set("bob", { arcs: 1, habits: 4, checkIns: 30 });
  data.profiles.set("bob", { displayName: "Bob", locale: "es", currentArcId: "arc1", createdAt: null, updatedAt: "2026-09-30T00:00:00.000Z" });
  svc = createAdminService({ auth, data, now: () => NOW });
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
  test("non-admins are refused before any I/O", async () => {
    const err = await failure(svc.listUsers(adminCtx(bob, { admin: false }), {}));
    expect(err.code).toBe("permission-denied");
    expect(data.rate.size).toBe(0);
  });

  test("an admin whose claim was removed is refused despite an old token", async () => {
    auth.users.set("alice", { ...alice, admin: false });
    expect((await failure(svc.stats(adminCtx(alice), {}))).code).toBe("permission-denied");
  });

  test("revoked sessions are refused", async () => {
    await auth.revokeRefreshTokens("alice");
    const err = await failure(svc.stats(adminCtx(alice, { auth_time: nowSec - 3600 }), {}));
    expect(err.code).toBe("unauthenticated");
    expect(err.reason).toBe("session-revoked");
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
    expect(toUserRow(user("x", { photoURL: "javascript:alert(1)" }), null).photoURL).toBeNull();
    expect(toUserRow(user("x", { photoURL: "https://lh3.googleusercontent.com/a" }), null).photoURL).toBe("https://lh3.googleusercontent.com/a");
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
    expect(data.audit[0]).toMatchObject({ actorUid: "alice", action: "user.disable", targetUid: "bob", reason: "abuse", outcome: "ok" });
  });
  test("enabling does not revoke", async () => {
    await svc.setDisabled(adminCtx(alice), { uid: "bob", disabled: false, reason: "appeal ok" });
    expect(auth.calls).toEqual(["setDisabled:bob:false"]);
    expect(data.audit[0]?.action).toBe("user.enable");
  });
  test("refuses self and admins", async () => {
    expect((await failure(svc.setDisabled(adminCtx(alice), { uid: "alice", disabled: true, reason: "oops" }))).reason).toBe("self-action");
    expect((await failure(svc.setDisabled(adminCtx(alice), { uid: "carol", disabled: true, reason: "oops" }))).reason).toBe("target-is-admin");
    expect(auth.calls).toEqual([]);
    expect(data.audit).toEqual([]);
  });
});

describe("deleteUser", () => {
  test("requires the typed email and deletes data then account", async () => {
    const err = await failure(svc.deleteUser(adminCtx(alice), { uid: "bob", confirm: "carol@example.com" }));
    expect(err.reason).toBe("confirm-mismatch");
    expect(auth.users.has("bob")).toBe(true);

    await svc.deleteUser(adminCtx(alice), { uid: "bob", confirm: "Bob@Example.com" });
    expect(auth.calls).toEqual(["setDisabled:bob:true", "revoke:bob", "deleteUser:bob"]);
    expect(data.calls).toEqual(["deleteData:bob"]);
    expect(auth.users.has("bob")).toBe(false);
    expect(data.audit[0]).toMatchObject({ action: "user.delete", targetEmail: "bob@example.com", outcome: "ok" });
  });

  test("uses the uid as confirmation when there is no email", async () => {
    auth.users.set("bob", { ...bob, email: null });
    await svc.deleteUser(adminCtx(alice), { uid: "bob", confirm: "bob" });
    expect(auth.users.has("bob")).toBe(false);
  });

  test("refuses self, admins and stale sign-ins", async () => {
    expect((await failure(svc.deleteUser(adminCtx(alice), { uid: "alice", confirm: "alice@example.com" }))).reason).toBe("self-action");
    expect((await failure(svc.deleteUser(adminCtx(alice), { uid: "carol", confirm: "carol@example.com" }))).reason).toBe("target-is-admin");
    const stale = adminCtx(alice, { auth_time: nowSec - 3 * 3600 });
    expect((await failure(svc.deleteUser(stale, { uid: "bob", confirm: "bob@example.com" }))).reason).toBe("recent-login-required");
    expect(auth.users.has("bob")).toBe(true);
  });

  test("audits failures and leaves the account disabled", async () => {
    data.failDeleteData = true;
    await expect(svc.deleteUser(adminCtx(alice), { uid: "bob", confirm: "bob@example.com" })).rejects.toThrow("boom");
    expect(data.audit[0]).toMatchObject({ action: "user.delete", outcome: "error" });
    expect(auth.users.get("bob")?.disabled).toBe(true);
  });
});

describe("setAdmin", () => {
  test("grants and revokes (revocation kills sessions)", async () => {
    await svc.setAdmin(adminCtx(alice), { uid: "bob", admin: true });
    expect(auth.users.get("bob")?.admin).toBe(true);
    await svc.setAdmin(adminCtx(alice), { uid: "bob", admin: false, reason: "rotation" });
    expect(auth.users.get("bob")?.admin).toBe(false);
    expect(auth.calls).toEqual(["setAdmin:bob:true", "setAdmin:bob:false", "revoke:bob"]);
    expect(data.audit.map((a) => a.action)).toEqual(["admin.revoke", "admin.grant"]);
  });

  test("refuses changing your own rights (so one admin always remains)", async () => {
    const err = await failure(svc.setAdmin(adminCtx(alice), { uid: "alice", admin: false }));
    expect(err.reason).toBe("self-action");
    expect(auth.users.get("alice")?.admin).toBe(true);
  });

  test("refuses disabled or unverified targets", async () => {
    auth.users.set("bob", { ...bob, emailVerified: false });
    expect((await failure(svc.setAdmin(adminCtx(alice), { uid: "bob", admin: true }))).code).toBe("failed-precondition");
  });

  test("rolls back if the actor was demoted concurrently", async () => {
    auth.onSetAdminClaim = (uid, admin) => {
      if (uid === "carol" && !admin) auth.users.set("alice", { ...auth.users.get("alice")!, admin: false });
    };
    const err = await failure(svc.setAdmin(adminCtx(alice), { uid: "carol", admin: false }));
    expect(err.code).toBe("aborted");
    expect(auth.users.get("carol")?.admin).toBe(true);
    expect(data.audit[0]?.outcome).toBe("error");
  });

  test("requires a recent sign-in", async () => {
    const stale = adminCtx(alice, { auth_time: nowSec - 3 * 3600 });
    expect((await failure(svc.setAdmin(stale, { uid: "bob", admin: true }))).reason).toBe("recent-login-required");
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
