import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SyncArc, SyncCheckIn, SyncHabit, SyncProfile } from "@cold-forge/sync";
import type { SyncPage } from "./sync.ts";
import { iso, startHarness, T0, type Harness } from "./testing.ts";

let h: Harness;
beforeEach(() => {
  h = startHarness();
});
afterEach(() => h.stop());

const ARC = "11111111-1111-4111-8111-111111111111";
const HABIT = "22222222-2222-4222-8222-222222222222";
const HABIT2 = "33333333-3333-4333-8333-333333333333";

const at = (minutesAgo: number) => iso(T0 - minutesAgo * 60_000);
const arc = (over: Partial<SyncArc> = {}): SyncArc => ({
  id: ARC,
  kind: "winter",
  startDate: "2026-10-01",
  endDate: "2026-12-31",
  why: "Be stronger",
  createdAt: at(100),
  updatedAt: at(100),
  ...over,
});
const habit = (over: Partial<SyncHabit> = {}): SyncHabit => ({
  id: HABIT,
  arcId: ARC,
  templateId: "coldShower",
  name: "",
  emoji: "🧊",
  order: 0,
  createdAt: at(100),
  updatedAt: at(100),
  ...over,
});
const checkIn = (over: Partial<SyncCheckIn> = {}): SyncCheckIn => ({
  habitId: HABIT,
  date: "2026-10-01",
  done: true,
  updatedAt: at(90),
  ...over,
});
const profile = (over: Partial<SyncProfile> = {}): SyncProfile => ({
  displayName: "Yahir",
  locale: "es",
  currentArcId: ARC,
  updatedAt: at(100),
  ...over,
});

const page = async (res: Response) => {
  expect(res.status).toBe(200);
  return (await res.json()) as SyncPage;
};

describe("sync", () => {
  test("round trip between two devices of the same user (LWW, tombstones, incremental cursor)", async () => {
    const phone = await h.login("me@example.com");
    const tablet = await h.login("me@example.com");

    // phone pushes everything
    const p1 = await page(
      await h.sync(phone.token, { arcs: [arc()], habits: [habit()], checkIns: [checkIn()], profile: profile() }),
    );
    expect(p1.protocol).toBe(1);
    expect(p1.hasMore).toBe(false);
    expect(p1.serverTime).toBe(iso(T0));
    expect(p1.changes.arcs).toEqual([arc()]); // echo includes what was just written
    expect(p1.changes.checkIns).toHaveLength(1);

    // tablet pulls everything on first sync
    const t1 = await page(await h.sync(tablet.token, {}));
    expect(t1.changes).toEqual({ arcs: [arc()], habits: [habit()], checkIns: [checkIn()], profile: profile() });

    // nothing new → empty incremental pull
    const t2 = await page(await h.sync(tablet.token, {}, t1.cursor));
    expect(t2.changes).toEqual({ arcs: [], habits: [], checkIns: [], profile: null });
    expect(t2.cursor).toBe(t1.cursor);

    // tablet un-checks (newer) and deletes the habit (tombstone)
    const tomb = habit({ updatedAt: at(10), deletedAt: at(10) });
    const uncheck = checkIn({ done: false, updatedAt: at(10) });
    await page(await h.sync(tablet.token, { habits: [tomb], checkIns: [uncheck] }, t2.cursor));

    // phone sends a STALE edit of the habit: it loses
    const p2 = await page(await h.sync(phone.token, { habits: [habit({ name: "old", updatedAt: at(50) })] }, p1.cursor));
    expect(p2.changes.habits).toEqual([tomb]);
    expect(p2.changes.checkIns).toEqual([uncheck]);
    expect(p2.changes.arcs).toEqual([]); // only what changed after the cursor

    // a tie keeps the stored record
    const tie = await page(await h.sync(phone.token, { habits: [habit({ name: "tie", updatedAt: at(10) })] }, p2.cursor));
    expect(tie.changes.habits).toEqual([]);

    // a newer edit wins and is visible to the tablet
    const revived = habit({ name: "Revived", updatedAt: at(1) });
    await page(await h.sync(phone.token, { habits: [revived] }, p2.cursor));
    const t3 = await page(await h.sync(tablet.token, {}, t2.cursor));
    expect(t3.changes.habits).toEqual([{ ...revived, templateId: "coldShower" }]);
  });

  test("replaying the same batch is idempotent", async () => {
    const { token } = await h.login("me@example.com");
    const first = await page(await h.sync(token, { arcs: [arc()], habits: [habit()], checkIns: [checkIn()] }));
    const again = await page(await h.sync(token, { arcs: [arc()], habits: [habit()], checkIns: [checkIn()] }, first.cursor));
    expect(again.cursor).toBe(first.cursor);
    expect(again.changes.checkIns).toEqual([]);
  });

  test("invalid cursors are rejected", async () => {
    const { token } = await h.login("me@example.com");
    for (const cursor of ["abc", "v1.-1", "v1.01", "v1.1e3", "v2.1", "v1.999"]) {
      const res = await h.sync(token, {}, cursor);
      expect(res.status).toBe(400);
    }
  });

  test("future timestamps are rejected by the validator", async () => {
    const { token } = await h.login("me@example.com");
    const res = await h.sync(token, { arcs: [arc({ updatedAt: iso(T0 + 10 * 60_000) })] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_request");
  });

  test("validation errors write nothing", async () => {
    const { token } = await h.login("me@example.com");
    await h.sync(token, { arcs: [arc()], habits: [habit({ templateId: "hack" as never })] });
    expect(h.db.query("SELECT COUNT(*) AS n FROM arcs").get()).toEqual({ n: 0 });
  });

  test("check-ins for unknown habits are ignored; habits in the same batch count", async () => {
    const { token } = await h.login("me@example.com");
    const res = await page(
      await h.sync(token, {
        habits: [habit({ id: HABIT2 })],
        checkIns: [checkIn({ habitId: HABIT }), checkIn({ habitId: HABIT2 })],
      }),
    );
    expect(res.changes.checkIns.map((c) => c.habitId)).toEqual([HABIT2]);
  });

  test("pagination with hasMore", async () => {
    h.stop();
    h = startHarness({ pageSize: 3 });
    const { token } = await h.login("me@example.com");
    const checkIns = Array.from({ length: 7 }, (_, i) => checkIn({ date: `2026-10-0${i + 1}` as SyncCheckIn["date"] }));
    const pushed = await page(await h.sync(token, { arcs: [arc()], habits: [habit()], checkIns }));
    expect(pushed.hasMore).toBe(true);

    const seen: SyncCheckIn[] = [];
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      const p = await page(await h.sync(token, {}, cursor));
      pages++;
      seen.push(...p.changes.checkIns);
      expect(p.changes.arcs.length + p.changes.habits.length + p.changes.checkIns.length).toBeLessThanOrEqual(3);
      cursor = p.cursor;
      if (!p.hasMore) break;
    }
    expect(pages).toBe(3); // 9 records / 3 per page
    expect(seen.map((c) => c.date).sort()).toEqual(checkIns.map((c) => c.date));
  });

  test("per-user storage quotas roll back the whole request", async () => {
    h.stop();
    h = startHarness({ quotas: { arcs: 1, habits: 2, checkIns: 3 } });
    const { token } = await h.login("me@example.com");
    const other = "44444444-4444-4444-8444-444444444444";
    const res = await h.sync(token, { arcs: [arc(), arc({ id: other })] });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "quota_exceeded" });
    expect(h.db.query("SELECT COUNT(*) AS n FROM arcs").get()).toEqual({ n: 0 });
    expect(h.db.query("SELECT seq FROM users").get()).toEqual({ seq: 0 });

    const ok = await h.sync(token, {
      arcs: [arc()],
      habits: [habit()],
      checkIns: ["01", "02", "03"].map((d) => checkIn({ date: `2026-10-${d}` as SyncCheckIn["date"] })),
    });
    expect(ok.status).toBe(200);
    // updating existing rows is fine at the cap; one more row is not
    expect((await h.sync(token, { checkIns: [checkIn({ done: false, updatedAt: at(1) })] })).status).toBe(200);
    expect((await h.sync(token, { checkIns: [checkIn({ date: "2026-10-04" })] })).status).toBe(422);
  });

  test("export returns everything including tombstones", async () => {
    const { token, user } = await h.login("me@example.com");
    await h.sync(token, {
      arcs: [arc()],
      habits: [habit({ deletedAt: at(50), updatedAt: at(50) })],
      checkIns: [checkIn()],
      profile: profile(),
    });
    const res = await h.request("GET", "/v1/export", { token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.user).toEqual(user);
    expect(body.exportedAt).toBe(iso(T0));
    expect(body.arcs).toHaveLength(1);
    expect((body.habits as SyncHabit[])[0]!.deletedAt).toBe(at(50));
    expect(body.checkIns).toHaveLength(1);
    expect(body.profile).toEqual(profile());
  });
});

describe("cross-user isolation (colliding client ids)", () => {
  test("user A cannot read, overwrite, delete or check in on user B's records using B's ids", async () => {
    const a = await h.login("a@example.com");
    const b = await h.login("b@example.com");
    await page(await h.sync(b.token, { arcs: [arc()], habits: [habit()], checkIns: [checkIn()], profile: profile() }));

    // A's first sync sees nothing of B
    const a1 = await page(await h.sync(a.token, {}));
    expect(a1.changes).toEqual({ arcs: [], habits: [], checkIns: [], profile: null });

    // A sends NEWER records with B's exact ids, a tombstone and a check-in on B's habit
    const a2 = await page(
      await h.sync(a.token, {
        arcs: [arc({ why: "pwned", updatedAt: at(1) })],
        habits: [habit({ name: "pwned", deletedAt: at(1), updatedAt: at(1) })],
        profile: profile({ displayName: "pwned", updatedAt: at(1) }),
      }),
    );
    // A only created its OWN copies
    expect(a2.changes.arcs[0]!.why).toBe("pwned");

    // A check-in for a habit A doesn't own (HABIT2 exists only for B) is ignored
    await page(await h.sync(b.token, { habits: [habit({ id: HABIT2 })] }));
    const a3 = await page(await h.sync(a.token, { checkIns: [checkIn({ habitId: HABIT2, updatedAt: at(1) })] }));
    expect(a3.changes.checkIns).toEqual([]);

    // B's data is untouched
    const b1 = await page(await h.sync(b.token, {}));
    expect(b1.changes.arcs).toEqual([arc()]);
    expect(b1.changes.habits.find((x) => x.id === HABIT)).toEqual(habit());
    expect(b1.changes.checkIns).toEqual([checkIn()]);
    expect(b1.changes.profile).toEqual(profile());

    // and A's export contains only A's data
    const exported = (await (await h.request("GET", "/v1/export", { token: a.token })).json()) as {
      habits: SyncHabit[];
      checkIns: SyncCheckIn[];
    };
    expect(exported.habits.map((x) => x.name)).toEqual(["pwned"]);
    expect(exported.checkIns).toEqual([]);
  });

  test("deleting an account removes everything and the token stops working; other users unaffected", async () => {
    const a = await h.login("a@example.com");
    const a2 = await h.login("a@example.com");
    const b = await h.login("b@example.com");
    const full = { arcs: [arc()], habits: [habit()], checkIns: [checkIn()], profile: profile() };
    await page(await h.sync(a.token, full));
    await page(await h.sync(b.token, full));
    await h.post("/v1/auth/magic-link", { email: "a@example.com", locale: "en" }); // pending login request

    expect((await h.request("DELETE", "/v1/me", { token: a.token })).status).toBe(204);
    expect((await h.request("GET", "/v1/me", { token: a.token })).status).toBe(401);
    expect((await h.request("GET", "/v1/me", { token: a2.token })).status).toBe(401);
    for (const table of ["arcs", "habits", "check_ins", "profiles", "sessions"]) {
      const rows = h.db.query(`SELECT user_id FROM ${table}`).all() as { user_id: string }[];
      expect(rows.every((r) => r.user_id === b.user.id)).toBe(true);
    }
    expect(h.db.query("SELECT email FROM users").all()).toEqual([{ email: "b@example.com" }]);
    expect(h.db.query("SELECT COUNT(*) AS n FROM login_requests").get()).toEqual({ n: 0 });

    const bPage = await page(await h.sync(b.token, {}));
    expect(bPage.changes.checkIns).toHaveLength(1);

    // signing up again creates a fresh, empty account (after the per-email limit window)
    h.advance(15 * 60_000);
    const again = await h.login("a@example.com");
    expect(again.user.id).not.toBe(a.user.id);
    expect((await page(await h.sync(again.token, {}))).changes.arcs).toEqual([]);
  });
});
