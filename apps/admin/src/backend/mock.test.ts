import { beforeAll, expect, test } from "bun:test";
import type { Backend, UserRowDto } from "./types.ts";

// mock.ts reads `location.search` (dev-only fixtures, never in production builds).
let backend: Backend;
beforeAll(async () => {
  (globalThis as { location?: unknown }).location ??= { search: "" };
  const { createMockBackend } = await import("./mock.ts");
  backend = createMockBackend();
});

test("mock mirrors the allowlist model: adminWhoAmI, isAdmin rows, no adminSetAdmin", async () => {
  expect(await backend.call("adminWhoAmI", {})).toEqual({ email: "owner@coldforge.work", isAdmin: true });
  const { users } = await backend.call("adminListUsers", { pageSize: 100 });
  expect(users.length).toBeGreaterThan(0);
  for (const u of users) {
    expect(typeof u.isAdmin).toBe("boolean");
    expect(Object.keys(u)).not.toContain("admin");
  }
  // @ts-expect-error the callable was removed (admins are managed through the ADMIN_ALLOWED_EMAILS secret)
  await expect(backend.call("adminSetAdmin", { uid: users[0]!.uid, admin: true })).rejects.toThrow();
});

test("mock refuses disabling or deleting an allowlisted account (target-is-admin)", async () => {
  const { users } = await backend.call("adminListUsers", { pageSize: 100 });
  const admin = users.find((u: UserRowDto) => u.isAdmin)!;
  await expect(backend.call("adminSetDisabled", { uid: admin.uid, disabled: true, reason: "test" })).rejects.toMatchObject({ reason: "target-is-admin" });
  await expect(backend.call("adminDeleteUser", { uid: admin.uid, confirm: admin.email ?? admin.uid })).rejects.toMatchObject({ reason: "target-is-admin" });
});

test("mock audit fixtures use only current action types", async () => {
  const { entries } = await backend.call("adminListAuditLog", {});
  for (const e of entries) expect(["user.view", "user.disable", "user.enable", "user.delete"]).toContain(e.action);
});
