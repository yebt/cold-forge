import { describe, expect, test } from "bun:test";
import { QUOTAS } from "../../../packages/sync/src/quotas.ts";
import { handleUserDeleted, onRecordCreated, QUOTA_JOB, recountCheckIns, sweepDeletedUsers } from "./quota.ts";
import { FakeQuota, NOW } from "./testing/fakes.ts";

const DAY = 86_400_000;
const log = () => {
  const lines: string[] = [];
  return { lines, info: (m: string) => void lines.push(`info ${m}`), warn: (m: string) => void lines.push(`warn ${m}`) };
};

describe("H1: arc/habit create triggers", () => {
  test("count every create; block the account once over QUOTAS (PoC E1: 500 arcs)", async () => {
    const q = new FakeQuota();
    const l = log();
    for (let i = 0; i < QUOTAS.arcs; i++) await onRecordCreated(q, "alice", "arcs", NOW, l);
    expect(q.quota.get("alice")?.arcs).toBe(50);
    expect(q.blocked.has("alice")).toBe(false);
    await onRecordCreated(q, "alice", "arcs", NOW, l);
    expect(q.blocked.get("alice")?.reason).toBe("quota");
    expect(l.lines).toContain("warn quota exceeded: account blocked");
    for (let i = 0; i < QUOTAS.habits + 1; i++) await onRecordCreated(q, "bob", "habits", NOW, l);
    expect(q.blocked.get("bob")?.reason).toBe("quota");
  });

  test("QUOTAS is the shared single source", () => {
    expect(QUOTAS).toEqual({ arcs: 50, habits: 500, checkIns: 50_000 });
  });
});

describe("H1: daily check-in recount", () => {
  test("recounts active and least-recently counted accounts; blocks over the cap; logs outliers", async () => {
    const q = new FakeQuota();
    const l = log();
    await onRecordCreated(q, "active", "habits", new Date(NOW.getTime() - DAY), l);
    await onRecordCreated(q, "abuser", "habits", new Date(NOW.getTime() - DAY), l);
    await onRecordCreated(q, "idle", "habits", new Date(NOW.getTime() - 30 * DAY), l);
    await q.saveCheckIns("idle", 10, new Date(NOW.getTime() - 8 * DAY)); // stale: recounted
    await onRecordCreated(q, "recent", "habits", new Date(NOW.getTime() - 30 * DAY), l);
    await q.saveCheckIns("recent", 10, new Date(NOW.getTime() - DAY)); // neither active nor stale: skipped
    q.checkInDocs.set("active", 120);
    q.checkInDocs.set("abuser", QUOTAS.checkIns + 1);
    q.checkInDocs.set("idle", 12);
    q.checkInDocs.set("recent", 99_999);
    const r = await recountCheckIns(q, NOW, l);
    expect(r.counted).toBe(3);
    expect(r.blocked).toEqual(["abuser"]);
    expect(r.outliers).toEqual(["abuser"]); // > outlierPerDay new docs since the last count
    expect(q.blocked.get("abuser")?.reason).toBe("quota");
    expect(q.blocked.has("recent")).toBe(false);
    expect(q.quota.get("idle")).toMatchObject({ checkIns: 12, countedAt: NOW.getTime() });
    expect(q.calls.filter((c) => c.startsWith("count:")).sort()).toEqual(["count:abuser", "count:active", "count:idle"]);
    expect(QUOTA_JOB.outlierPerDay).toBe(5_000);
  });
});

describe("M1: account deletion", () => {
  test("onUserDeleted blocks the uid before erasing its data (unit: the emulator can't run the Auth trigger here)", async () => {
    const q = new FakeQuota();
    q.users.add("gone");
    await handleUserDeleted(q, "gone");
    expect(q.calls).toEqual(["block:gone:deleted", "deleteData:gone"]);
    expect(q.blocked.get("gone")).toEqual({ reason: "deleted", sweepAfter: NOW.getTime() + QUOTA_JOB.sweepDelayMs });
  });

  test("a deleted block is never downgraded; a quota block is upgraded to deleted", async () => {
    const q = new FakeQuota();
    await q.setBlocked("x", "quota");
    await handleUserDeleted(q, "x");
    expect(q.blocked.get("x")?.reason).toBe("deleted");
    await q.setBlocked("x", "disabled");
    expect(q.blocked.get("x")?.reason).toBe("deleted");
  });

  test("an hour later the sweep erases users/{uid} once more and keeps the block", async () => {
    const q = new FakeQuota();
    await handleUserDeleted(q, "gone");
    q.calls.length = 0;
    expect(await sweepDeletedUsers(q, new Date(NOW.getTime() + 30 * 60_000), log())).toBe(0);
    expect(await sweepDeletedUsers(q, new Date(NOW.getTime() + 61 * 60_000), log())).toBe(1);
    expect(q.calls).toEqual(["deleteData:gone"]);
    expect(q.blocked.get("gone")).toEqual({ reason: "deleted", sweepAfter: null });
    expect(await sweepDeletedUsers(q, new Date(NOW.getTime() + 3 * 3_600_000), log())).toBe(0);
  });
});
