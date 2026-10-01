/**
 * Firestore security rules tests (firebase/firestore.rules) against the Firestore emulator.
 *
 *   bun run --cwd firebase test:rules
 *
 * (= `firebase emulators:exec --only firestore "bun test ./rules.test.ts"`, firebase-tools pinned). Without an emulator
 * (no FIRESTORE_EMULATOR_HOST) the suite is skipped, so the repo-wide `bun test` stays green.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, getDocs, collection, serverTimestamp, setDoc, writeBatch, type Firestore } from "firebase/firestore";
import { LIMITS, isEmoji, parseSyncRequest } from "@cold-forge/sync";

const HOST = process.env.FIRESTORE_EMULATOR_HOST;
const suite = HOST ? describe : describe.skip;

const UID = "alice";
const OTHER = "bob";
const ARC = "11111111-1111-4111-8111-111111111111";
const HABIT = "22222222-2222-4222-8222-222222222222";
// Relative to the real clock: the rules refuse timestamps more than 5 minutes ahead.
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const DAY = 86_400_000;
const T0 = iso(2 * DAY);
const T1 = iso(DAY);
/** Old but still a valid write timestamp (>= 2024-01-01). */
const OLD = "2024-06-01T00:00:00.000Z";
const ARC2 = "33333333-3333-4333-8333-333333333333";
const HABIT2 = "44444444-4444-4444-8444-444444444444";
/** UTC calendar date `days` from now (check-in dates must be within [now - 400 d, now + 2 d]). */
const dayOffset = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
const TODAY = dayOffset(0);

const googleToken = (extra: Record<string, unknown> = {}) => ({
  email: "alice@gmail.com",
  email_verified: true,
  firebase: { sign_in_provider: "google.com" },
  ...extra,
});

const arc = (over: Record<string, unknown> = {}) => ({
  id: ARC,
  kind: "winter",
  startDate: "2026-10-01",
  endDate: "2026-12-31",
  why: "Be stronger\nevery day",
  createdAt: T0,
  updatedAt: T0,
  syncedAt: serverTimestamp(),
  ...over,
});

/** Drops keys set to `undefined` (the SDK refuses them), so overrides can remove a field. */
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const habit = (over: Record<string, unknown> = {}) => clean({
  id: HABIT,
  arcId: ARC,
  templateId: "coldShower",
  name: "",
  emoji: "🧊",
  order: 0,
  createdAt: T0,
  updatedAt: T0,
  syncedAt: serverTimestamp(),
  ...over,
});

const checkIn = (over: Record<string, unknown> = {}) => ({
  habitId: HABIT,
  date: TODAY,
  done: true,
  updatedAt: T0,
  syncedAt: serverTimestamp(),
  ...over,
});

const profile = (over: Record<string, unknown> = {}) => ({
  displayName: "Alice",
  locale: "es",
  currentArcId: ARC,
  updatedAt: T0,
  createdAt: T0,
  syncedAt: serverTimestamp(),
  ...over,
});

const future = () => new Date(Date.now() + 60 * 60_000).toISOString();

let env: RulesTestEnvironment;

suite("firestore.rules", () => {
  beforeAll(async () => {
    const [host, port] = HOST!.split(":");
    env = await initializeTestEnvironment({
      projectId: "demo-coldforge",
      firestore: { rules: readFileSync(new URL("./firestore.rules", import.meta.url), "utf8"), host, port: Number(port) },
    });
  });
  afterAll(async () => {
    await env?.cleanup();
  });
  beforeEach(async () => {
    await env.clearFirestore();
  });

  const as = (uid: string, token = googleToken()): Firestore => env.authenticatedContext(uid, token).firestore() as unknown as Firestore;
  const alice = () => as(UID);
  const path = (...p: string[]) => ["users", UID, ...p].join("/");

  /** Arc + habit already there (written by alice). */
  async function seed() {
    const db = alice();
    await assertSucceeds(setDoc(doc(db, path("arcs", ARC)), arc()));
    await assertSucceeds(setDoc(doc(db, path("habits", HABIT)), habit()));
  }

  describe("who", () => {
    test("the owner can write and read their own data", async () => {
      await seed();
      const db = alice();
      await assertSucceeds(setDoc(doc(db, path()), profile()));
      await assertSucceeds(setDoc(doc(db, path("checkIns", `${HABIT}_${TODAY}`)), checkIn()));
      await assertSucceeds(getDoc(doc(db, path("arcs", ARC))));
      await assertSucceeds(getDocs(collection(db, path("habits"))));
    });

    test("another user can't read or write it", async () => {
      await seed();
      const db = as(OTHER, googleToken({ email: "bob@gmail.com" }));
      await assertFails(getDoc(doc(db, path("arcs", ARC))));
      await assertFails(getDocs(collection(db, path("habits"))));
      await assertFails(setDoc(doc(db, path("arcs", ARC)), arc({ updatedAt: T1 })));
      await assertFails(setDoc(doc(db, path()), profile()));
    });

    test("unauthenticated is denied", async () => {
      const db = env.unauthenticatedContext().firestore() as unknown as Firestore;
      await assertFails(getDoc(doc(db, path())));
      await assertFails(setDoc(doc(db, path("arcs", ARC)), arc()));
    });

    test("an unverified email or a non-Google provider is denied", async () => {
      await assertFails(setDoc(doc(as(UID, googleToken({ email_verified: false })), path("arcs", ARC)), arc()));
      await assertFails(setDoc(doc(as(UID, googleToken({ firebase: { sign_in_provider: "password" } })), path("arcs", ARC)), arc()));
      await assertFails(setDoc(doc(as(UID, googleToken({ firebase: { sign_in_provider: "anonymous" } })), path("arcs", ARC)), arc()));
    });

    test("nothing at the top level is client-accessible (adminAuditLog)", async () => {
      const db = alice();
      await assertFails(getDoc(doc(db, "adminAuditLog/x")));
      await assertFails(getDocs(collection(db, "adminAuditLog")));
      await assertFails(setDoc(doc(db, "adminAuditLog/x"), { a: 1 }));
      await assertFails(getDocs(collection(db, "users")));
      await assertFails(setDoc(doc(db, "other/x"), { a: 1 }));
    });
  });

  describe("shapes", () => {
    test("extra keys, missing keys and wrong types are refused", async () => {
      const db = alice();
      await assertFails(setDoc(doc(db, path("arcs", ARC)), arc({ isAdmin: true })));
      const { why: _why, ...noWhy } = arc();
      await assertFails(setDoc(doc(db, path("arcs", ARC)), noWhy));
      await assertFails(setDoc(doc(db, path("arcs", ARC)), arc({ kind: "summer" })));
      await assertFails(setDoc(doc(db, path("arcs", ARC)), arc({ startDate: "2026-02-30" })));
      await assertFails(setDoc(doc(db, path("arcs", ARC)), arc({ startDate: "2027-01-01" }))); // after endDate
      await assertFails(setDoc(doc(db, path("arcs", ARC)), arc({ updatedAt: "2026-10-01T08:00:00Z" }))); // not canonical
      await assertFails(setDoc(doc(db, path("arcs", ARC)), arc({ syncedAt: new Date() }))); // must be server time
      await assertSucceeds(setDoc(doc(db, path("arcs", ARC)), arc()));
      await assertFails(setDoc(doc(db, path("habits", HABIT)), habit({ order: 1.5 })));
      await assertFails(setDoc(doc(db, path("habits", HABIT)), habit({ order: 10_001 })));
      await assertFails(setDoc(doc(db, path("habits", HABIT)), habit({ templateId: "hack" })));
      await assertFails(setDoc(doc(db, path("habits", HABIT)), habit({ templateId: undefined, name: "   " }))); // blank custom name
      await assertSucceeds(setDoc(doc(db, path("habits", HABIT)), habit()));
      await assertFails(setDoc(doc(db, path("checkIns", `${HABIT}_${TODAY}`)), checkIn({ done: "yes" })));
      await assertFails(setDoc(doc(db, path()), profile({ locale: "fr" })));
      await assertFails(setDoc(doc(db, path()), profile({ currentArcId: "nope" })));
    });

    test("oversized and unsafe strings are refused", async () => {
      const db = alice();
      await assertFails(setDoc(doc(db, path("arcs", ARC)), arc({ why: "y".repeat(281) })));
      await assertSucceeds(setDoc(doc(db, path("arcs", ARC)), arc({ why: "y".repeat(280) })));
      const h = (over: Record<string, unknown>) => setDoc(doc(db, path("habits", HABIT)), habit({ templateId: undefined, name: "Run", ...over }));
      await assertFails(h({ name: "x".repeat(61) }));
      await assertFails(h({ name: "evil‮gnp" }));
      await assertFails(h({ name: "zero​width" }));
      await assertFails(h({ name: "line\nbreak" }));
      await assertFails(h({ name: "á́́́" }));
      await assertFails(h({ emoji: "🔥".repeat(17) }));
      await assertFails(h({ emoji: "abc" }));
      await assertFails(h({ emoji: "​🔥" }));
      await assertSucceeds(h({ emoji: "👨‍👩‍👧" }));
      await assertFails(setDoc(doc(db, path()), profile({ displayName: "n".repeat(41) })));
    });

    test("PoC C1/C2/C3: the emoji field holds emoji only (no text, spaces or markup)", async () => {
      await seed();
      const db = alice();
      const h = (emoji: string) => setDoc(doc(db, path("habits", HABIT2)), habit({ id: HABIT2, templateId: undefined, name: "Run", emoji }));
      for (const bad of ["🔥 hello world!!", "🔥<img src=x>", "©abcdefghijklmno", "🔥a", "🔥 ", "⠀", "🔥\u{E0041}", "🧊‮", "1"]) {
        expect([bad, isEmoji(bad)]).toEqual([bad, false]);
        await assertFails(h(bad));
      }
      for (const ok of ["🧊", "🏋️", "1️⃣", "#️⃣", "👨‍👩‍👧‍👦", "🇲🇽", "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "👍🏽", "❤️", "🧊🔥", "©️"]) {
        expect([ok, isEmoji(ok)]).toEqual([ok, true]);
        await assertSucceeds(h(ok));
        await env.clearFirestore();
        await seed();
      }
    });

    test("PoC C4/C5/C6/C34: names and displayName made only of space separators are refused", async () => {
      await seed();
      const db = alice();
      const blanks = ["\u00a0\u00a0\u00a0", "\u3000", "\u2000\u2001", "\u202f", "\u205f", "\u1680"];
      for (const b of blanks) {
        await assertFails(setDoc(doc(db, path("habits", HABIT2)), habit({ id: HABIT2, templateId: undefined, name: b })));
        await assertFails(setDoc(doc(db, path("habits", HABIT2)), habit({ id: HABIT2, name: b }))); // template habit: "" or visible
        await assertFails(setDoc(doc(db, path()), profile({ displayName: b })));
        expect(parseSyncRequest({ protocol: 1, cursor: null, changes: { arcs: [], habits: [], checkIns: [], profile: { displayName: b, locale: "en", currentArcId: null, updatedAt: T0 } } }).ok).toBe(false);
      }
      await assertSucceeds(setDoc(doc(db, path()), profile({ displayName: "" })));
      await assertSucceeds(setDoc(doc(db, path("habits", HABIT2)), habit({ id: HABIT2, name: "" })));
    });

    test("L1: lengths count UTF-16 units, exactly like the client validator", async () => {
      await seed();
      const db = alice();
      const client = (changes: Record<string, unknown>) =>
        parseSyncRequest({ protocol: 1, cursor: null, changes: { arcs: [], habits: [], checkIns: [], profile: null, ...changes } }).ok;
      const cases: [string, number, string][] = [
        ["name", LIMITS.nameLength, "💪"],
        ["why", LIMITS.whyLength, "😀"],
        ["displayName", LIMITS.displayNameLength, "🔥"],
        ["name", LIMITS.nameLength, "x"],
      ];
      let ago = 100_000; // strictly newer updatedAt on every write (last-write-wins)
      const next = () => iso((ago -= 1_000));
      for (const [field, max, unit] of cases) {
        const fits = unit.repeat(max / unit.length);
        const over = unit.repeat(max / unit.length + 1);
        for (const [value, expected] of [[fits, true], [over, false]] as const) {
          let rules: Promise<unknown>;
          let ok: boolean;
          if (field === "name") {
            const h = habit({ id: HABIT2, templateId: undefined, name: value, syncedAt: undefined });
            ok = client({ habits: [h] });
            rules = setDoc(doc(db, path("habits", HABIT2)), habit({ id: HABIT2, templateId: undefined, name: value, updatedAt: next() }));
          } else if (field === "why") {
            ok = client({ arcs: [{ ...arc({ id: ARC2, why: value }), syncedAt: undefined }] });
            rules = setDoc(doc(db, path("arcs", ARC2)), arc({ id: ARC2, why: value, updatedAt: next() }));
          } else {
            ok = client({ profile: { displayName: value, locale: "en", currentArcId: null, updatedAt: T0 } });
            rules = setDoc(doc(db, path()), profile({ displayName: value, updatedAt: next() }));
          }
          expect([field, unit, value.length, ok]).toEqual([field, unit, value.length, expected]);
          if (expected) await assertSucceeds(rules);
          else await assertFails(rules);
        }
      }
      // 30 × 💪 (60 units) is a valid name for both; 31 is not. Emoji field: 16 units max.
      expect(isEmoji("🔥".repeat(2))).toBe(true);
      await assertFails(setDoc(doc(db, path("habits", HABIT2)), habit({ id: HABIT2, emoji: "👨‍👩‍👧‍👦👨‍👩‍👧‍👦" }))); // 22 units
      expect(isEmoji("👨‍👩‍👧‍👦👨‍👩‍👧‍👦")).toBe(false);
    });

    test("a far-future updatedAt is refused (it would win every merge)", async () => {
      const db = alice();
      await assertFails(setDoc(doc(db, path("arcs", ARC)), arc({ updatedAt: future() })));
      await assertSucceeds(setDoc(doc(db, path("arcs", ARC)), arc({ updatedAt: new Date(Date.now() + 60_000).toISOString() })));
    });
  });

  describe("ids and references", () => {
    test("the doc id must be the record id", async () => {
      const db = alice();
      await assertFails(setDoc(doc(db, path("arcs", "33333333-3333-4333-8333-333333333333")), arc()));
      await seed();
      await assertFails(setDoc(doc(db, path("checkIns", `${HABIT}_${dayOffset(-1)}`)), checkIn()));
      await assertFails(setDoc(doc(db, path("checkIns", "anything")), checkIn()));
    });

    test("a habit needs its arc, a check-in its habit (same user)", async () => {
      const db = alice();
      await assertFails(setDoc(doc(db, path("habits", HABIT)), habit()));
      // Bob's arc doesn't count for alice.
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore() as unknown as Firestore, `users/${OTHER}/arcs/${ARC}`), arc());
      });
      await assertFails(setDoc(doc(db, path("habits", HABIT)), habit()));
      await assertFails(setDoc(doc(db, path("checkIns", `${HABIT}_${TODAY}`)), checkIn()));
      // Arc + habit + check-in in one batch is fine (existsAfter).
      const b = writeBatch(db);
      b.set(doc(db, path("arcs", ARC)), arc());
      b.set(doc(db, path("habits", HABIT)), habit());
      b.set(doc(db, path("checkIns", `${HABIT}_${TODAY}`)), checkIn());
      await assertSucceeds(b.commit());
    });
  });

  describe("last-write-wins", () => {
    test("an update needs a strictly newer updatedAt", async () => {
      await seed();
      const db = alice();
      await assertFails(setDoc(doc(db, path("arcs", ARC)), arc({ why: "same time" })));
      await assertFails(setDoc(doc(db, path("arcs", ARC)), arc({ why: "older", updatedAt: "2026-09-01T00:00:00.000Z" })));
      await assertSucceeds(setDoc(doc(db, path("arcs", ARC)), arc({ why: "newer", updatedAt: T1 })));
    });

    test("profile createdAt can't change", async () => {
      await seed();
      const db = alice();
      await assertSucceeds(setDoc(doc(db, path()), profile()));
      await assertFails(setDoc(doc(db, path()), profile({ updatedAt: T1, createdAt: T1 })));
      await assertSucceeds(setDoc(doc(db, path()), { displayName: "New", locale: "en", currentArcId: null, updatedAt: T1, syncedAt: serverTimestamp() }, { merge: true }));
    });
  });

  describe("deletion", () => {
    test("clients can't delete anything, not even their own data (tombstones only)", async () => {
      await seed();
      await assertSucceeds(setDoc(doc(alice(), path()), profile()));
      await assertSucceeds(setDoc(doc(alice(), path("checkIns", `${HABIT}_${TODAY}`)), checkIn()));
      const bob = as(OTHER, googleToken({ email: "bob@gmail.com" }));
      await assertFails(deleteDoc(doc(bob, path("habits", HABIT))));
      await assertFails(deleteDoc(doc(alice(), path("checkIns", `${HABIT}_${TODAY}`))));
      await assertFails(deleteDoc(doc(alice(), path("habits", HABIT))));
      await assertFails(deleteDoc(doc(alice(), path("arcs", ARC))));
      await assertFails(deleteDoc(doc(alice(), path())));
    });

    test("PoC D2/D4: delete + recreate to bypass last-write-wins or createdAt is impossible", async () => {
      await seed();
      const db = alice();
      await assertSucceeds(setDoc(doc(db, path()), profile()));
      const b = writeBatch(db);
      b.delete(doc(db, path("arcs", ARC)));
      b.set(doc(db, path("arcs", ARC)), arc({ updatedAt: OLD, createdAt: OLD }));
      await assertFails(b.commit());
      await assertFails(deleteDoc(doc(db, path())));
    });
  });

  describe("integrity", () => {
    test("PoC D3: createdAt is immutable for arcs, habits and the profile", async () => {
      await seed();
      const db = alice();
      await assertSucceeds(setDoc(doc(db, path()), profile()));
      await assertFails(setDoc(doc(db, path("arcs", ARC)), arc({ createdAt: iso(3 * DAY), updatedAt: T1 })));
      await assertFails(setDoc(doc(db, path("habits", HABIT)), habit({ createdAt: iso(3 * DAY), updatedAt: T1 })));
      await assertFails(setDoc(doc(db, path()), profile({ createdAt: iso(3 * DAY), updatedAt: T1 })));
      await assertSucceeds(setDoc(doc(db, path("arcs", ARC)), arc({ updatedAt: T1 })));
      await assertSucceeds(setDoc(doc(db, path("habits", HABIT)), habit({ updatedAt: T1 })));
    });

    test("PoC C31: createdAt must not be after updatedAt", async () => {
      const db = alice();
      await assertFails(setDoc(doc(db, path("arcs", ARC)), arc({ createdAt: T1, updatedAt: T0 })));
      await assertSucceeds(setDoc(doc(db, path("arcs", ARC)), arc()));
      await assertFails(setDoc(doc(db, path("habits", HABIT)), habit({ createdAt: iso(-240_000), updatedAt: iso(5_000) })));
      await assertFails(setDoc(doc(db, path()), profile({ currentArcId: null, createdAt: T1, updatedAt: T0 })));
    });

    test("PoC D5: currentArcId must be null or an existing arc of the same user", async () => {
      const db = alice();
      await assertFails(setDoc(doc(db, path()), profile()));
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore() as unknown as Firestore, `users/${OTHER}/arcs/${ARC}`), arc());
      });
      await assertFails(setDoc(doc(db, path()), profile())); // bob's arc doesn't count
      await assertSucceeds(setDoc(doc(db, path()), profile({ currentArcId: null })));
      const b = writeBatch(db);
      b.set(doc(db, path("arcs", ARC)), arc());
      b.set(doc(db, path()), profile({ updatedAt: T1, currentArcId: ARC }), { merge: true });
      await assertSucceeds(b.commit());
      await assertFails(
        setDoc(doc(db, path()), { currentArcId: "99999999-9999-4999-8999-999999999999", updatedAt: iso(1000), syncedAt: serverTimestamp() }, { merge: true }),
      );
    });

    test("PoC D6/D7: no new children under a tombstoned arc or habit", async () => {
      await seed();
      const db = alice();
      const H2 = "55555555-5555-4555-8555-555555555555";
      await assertSucceeds(setDoc(doc(db, path("habits", HABIT)), habit({ deletedAt: T1, updatedAt: T1 })));
      await assertFails(setDoc(doc(db, path("checkIns", `${HABIT}_${TODAY}`)), checkIn()));
      await assertSucceeds(setDoc(doc(db, path("arcs", ARC)), arc({ deletedAt: T1, updatedAt: T1 })));
      await assertFails(setDoc(doc(db, path("habits", H2)), habit({ id: H2 })));
      // Tombstoning a habit of a tombstoned arc is still fine.
      await assertSucceeds(setDoc(doc(db, path("habits", H2)), habit({ id: H2, deletedAt: T1, updatedAt: T1 })));
      // A habit and its tombstone + a check-in in one batch: the check-in is refused (getAfter).
      const b = writeBatch(db);
      b.set(doc(db, path("arcs", ARC2)), arc({ id: ARC2 }));
      b.set(doc(db, path("habits", HABIT2)), habit({ id: HABIT2, arcId: ARC2, deletedAt: T1, updatedAt: T1 }));
      b.set(doc(db, path("checkIns", `${HABIT2}_${TODAY}`)), checkIn({ habitId: HABIT2 }));
      await assertFails(b.commit());
    });

    test("a batch with 15 distinct parents + profile still fits the rules' lookup limit", async () => {
      const db = alice();
      const ids = Array.from({ length: 15 }, (_, i) => `${String(i).padStart(8, "a")}-0000-4000-8000-000000000000`);
      const b1 = writeBatch(db);
      b1.set(doc(db, path("arcs", ARC)), arc());
      for (const id of ids) b1.set(doc(db, path("habits", id)), habit({ id }));
      b1.set(doc(db, path()), profile());
      await assertSucceeds(b1.commit());
      const b2 = writeBatch(db);
      for (const id of ids) b2.set(doc(db, path("checkIns", `${id}_${TODAY}`)), checkIn({ habitId: id }));
      b2.set(doc(db, path()), profile({ updatedAt: T1 }), { merge: true });
      await assertSucceeds(b2.commit());
    });
  });

  describe("bounded key spaces (H1)", () => {
    test("PoC C19/C20/E2: check-in dates only within [now - 400 d, now + 2 d]", async () => {
      await seed();
      const db = alice();
      const ci = (date: string) => setDoc(doc(db, path("checkIns", `${HABIT}_${date}`)), checkIn({ date }));
      await assertFails(ci("9999-12-31"));
      await assertFails(ci("0001-01-01"));
      await assertFails(ci("1900-01-01"));
      await assertFails(ci(dayOffset(-402)));
      await assertFails(ci(dayOffset(3)));
      await assertSucceeds(ci(dayOffset(-399)));
      await assertSucceeds(ci(dayOffset(1)));
      await assertSucceeds(ci(TODAY));
    });

    test("PoC C18: an arc starts on/after 2024-01-01 and spans at most 366 days", async () => {
      const db = alice();
      const a = (startDate: string, endDate: string) => setDoc(doc(db, path("arcs", ARC)), arc({ startDate, endDate }));
      await assertFails(a("0001-01-01", "9999-12-31"));
      await assertFails(a("2023-12-31", "2024-01-31"));
      await assertFails(a("2026-01-01", "2027-01-02")); // 367 days
      await assertSucceeds(a("2024-01-01", "2024-12-31")); // 366 days (leap year)
    });

    test("PoC C23: timestamps before 2024-01-01 are refused", async () => {
      await seed();
      const db = alice();
      await assertFails(setDoc(doc(db, path("checkIns", `${HABIT}_${TODAY}`)), checkIn({ updatedAt: "0001-01-01T00:00:00.000Z" })));
      await assertFails(setDoc(doc(db, path("checkIns", `${HABIT}_${TODAY}`)), checkIn({ updatedAt: "2023-12-31T23:59:59.999Z" })));
      await assertFails(setDoc(doc(db, path("arcs", ARC2)), arc({ id: ARC2, createdAt: "2023-12-31T23:59:59.999Z" })));
      await assertFails(setDoc(doc(db, path("arcs", ARC2)), arc({ id: ARC2, deletedAt: "2023-12-31T23:59:59.999Z" })));
      await assertSucceeds(setDoc(doc(db, path("arcs", ARC2)), arc({ id: ARC2, createdAt: "2024-01-01T00:00:00.000Z" })));
    });
  });

  describe("blocked accounts (H1/M1)", () => {
    test("blocked/{uid} cuts reads and writes at once; the block is not client-visible", async () => {
      await seed();
      const db = alice();
      await assertSucceeds(getDoc(doc(db, path("arcs", ARC))));
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore() as unknown as Firestore, `blocked/${UID}`), { reason: "quota", at: serverTimestamp() });
      });
      await assertFails(getDoc(doc(db, path("arcs", ARC))));
      await assertFails(getDocs(collection(db, path("checkIns"))));
      await assertFails(setDoc(doc(db, path("arcs", ARC)), arc({ updatedAt: T1 })));
      await assertFails(getDoc(doc(db, `blocked/${UID}`)));
      await assertFails(setDoc(doc(db, `blocked/${UID}`), { reason: "none" }));
      await assertFails(getDoc(doc(db, `quota/${UID}`)));
      await assertFails(setDoc(doc(db, `quota/${UID}`), { arcs: 0 }));
      // Other users are unaffected.
      const bob = as(OTHER, googleToken({ email: "bob@gmail.com" }));
      await assertSucceeds(setDoc(doc(bob, `users/${OTHER}/arcs/${ARC}`), arc()));
    });
  });
});

test("rules file is present", () => {
  expect(readFileSync(new URL("./firestore.rules", import.meta.url), "utf8")).toContain("rules_version = '2'");
});
