import { expect, test } from "bun:test";
import type { UserRecord } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import { toAuditEntry, toAuthUser, toProfileView } from "./firebase.ts";

test("toAuthUser maps only safe fields", () => {
  const record = {
    uid: "u1",
    email: "a@b.co",
    emailVerified: true,
    displayName: "A",
    photoURL: "https://lh3.googleusercontent.com/x",
    disabled: false,
    metadata: { creationTime: "Thu, 01 Oct 2026 10:00:00 GMT", lastSignInTime: "Thu, 01 Oct 2026 11:00:00 GMT", lastRefreshTime: null },
    providerData: [{ providerId: "google.com" }],
    customClaims: { admin: true, other: 1 },
    tokensValidAfterTime: "Thu, 01 Oct 2026 10:00:00 GMT",
    passwordHash: "secret",
    passwordSalt: "salt",
  } as unknown as UserRecord;
  const u = toAuthUser(record);
  expect(u).toEqual({
    uid: "u1",
    email: "a@b.co",
    emailVerified: true,
    displayName: "A",
    photoURL: "https://lh3.googleusercontent.com/x",
    disabled: false,
    createdAt: "2026-10-01T10:00:00.000Z",
    lastSignIn: "2026-10-01T11:00:00.000Z",
    lastRefresh: null,
    providers: ["google.com"],
    tokensValidAfter: "2026-10-01T10:00:00.000Z",
  });
  expect(JSON.stringify(u)).not.toContain("secret");
});

test("custom claims (including a leftover `admin` claim) are never read", () => {
  const record = { uid: "u", customClaims: { admin: true }, metadata: {}, providerData: [] } as unknown as UserRecord;
  const u = toAuthUser(record);
  expect(Object.keys(u)).not.toContain("admin");
  expect(JSON.stringify(u)).not.toContain("admin");
});

test("toProfileView whitelists and normalises", () => {
  const view = toProfileView({
    displayName: "x".repeat(500),
    locale: "es",
    currentArcId: 5,
    createdAt: Timestamp.fromMillis(Date.UTC(2026, 0, 1)),
    updatedAt: "2026-09-30T00:00:00.000Z",
    secret: "nope",
  });
  expect(view.displayName?.length).toBe(200);
  expect(view.currentArcId).toBeNull();
  expect(view.createdAt).toBe("2026-01-01T00:00:00.000Z");
  expect(Object.keys(view)).not.toContain("secret");
});

test("removed audit actions (admin.grant / admin.revoke) read as unknown", () => {
  expect(toAuditEntry("old1", { action: "admin.grant", outcome: "ok" }).action).toBe("unknown");
  expect(toAuditEntry("old2", { action: "admin.revoke", outcome: "ok" }).action).toBe("unknown");
});

test("toAuditEntry is defensive about stored data", () => {
  const e = toAuditEntry("id1", { actorUid: "a", action: "evil", outcome: "weird", at: Timestamp.fromMillis(0) });
  expect(e.action).toBe("unknown");
  expect(e.outcome).toBe("ok");
  expect(e.at).toBe("1970-01-01T00:00:00.000Z");
});

test("toAuditEntry keeps refusals and their code (L5)", () => {
  const e = toAuditEntry("id2", { actorUid: "a", action: "user.view", outcome: "refused", code: "rate-limited", at: Timestamp.fromMillis(0) });
  expect([e.action, e.outcome, e.code]).toEqual(["user.view", "refused", "rate-limited"]);
  expect(toAuditEntry("id3", { action: "user.delete", outcome: "ok" }).code).toBeNull();
});
