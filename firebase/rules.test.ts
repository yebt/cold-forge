/**
 * Firestore security rules tests (firebase/firestore.rules) against the Firestore emulator.
 *
 *   cd firebase && bun install && bun run test:rules
 *
 * (= `firebase emulators:exec --only firestore "bun test ./rules.test.ts"`). Without an emulator
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

const HOST = process.env.FIRESTORE_EMULATOR_HOST;
const suite = HOST ? describe : describe.skip;

const UID = "alice";
const OTHER = "bob";
const ARC = "11111111-1111-4111-8111-111111111111";
const HABIT = "22222222-2222-4222-8222-222222222222";
// Relative to the real clock: the rules refuse timestamps more than 5 minutes ahead.
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const T0 = iso(2 * 86_400_000);
const T1 = iso(86_400_000);

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
  date: "2026-10-01",
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
      await assertSucceeds(setDoc(doc(db, path("checkIns", `${HABIT}_2026-10-01`)), checkIn()));
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
      await assertFails(setDoc(doc(db, path("checkIns", `${HABIT}_2026-10-01`)), checkIn({ done: "yes" })));
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
      await assertFails(setDoc(doc(db, path("checkIns", `${HABIT}_2026-10-02`)), checkIn()));
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
      await assertFails(setDoc(doc(db, path("checkIns", `${HABIT}_2026-10-01`)), checkIn()));
      // Arc + habit + check-in in one batch is fine (existsAfter).
      const b = writeBatch(db);
      b.set(doc(db, path("arcs", ARC)), arc());
      b.set(doc(db, path("habits", HABIT)), habit());
      b.set(doc(db, path("checkIns", `${HABIT}_2026-10-01`)), checkIn());
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
      const db = alice();
      await assertSucceeds(setDoc(doc(db, path()), profile()));
      await assertFails(setDoc(doc(db, path()), profile({ updatedAt: T1, createdAt: T1 })));
      await assertSucceeds(setDoc(doc(db, path()), { displayName: "New", locale: "en", currentArcId: null, updatedAt: T1, syncedAt: serverTimestamp() }, { merge: true }));
    });
  });

  describe("deletion", () => {
    test("the owner can delete everything; others can't", async () => {
      await seed();
      await assertSucceeds(setDoc(doc(alice(), path()), profile()));
      const bob = as(OTHER, googleToken({ email: "bob@gmail.com" }));
      await assertFails(deleteDoc(doc(bob, path("habits", HABIT))));
      await assertSucceeds(deleteDoc(doc(alice(), path("habits", HABIT))));
      await assertSucceeds(deleteDoc(doc(alice(), path("arcs", ARC))));
      await assertSucceeds(deleteDoc(doc(alice(), path())));
    });
  });
});

test("rules file is present", () => {
  expect(readFileSync(new URL("./firestore.rules", import.meta.url), "utf8")).toContain("rules_version = '2'");
});
