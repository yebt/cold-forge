/**
 * End-to-end against the Auth + Firestore emulators: the app's real Firestore port and transport,
 * the real security rules (firebase/firestore.rules, loaded by the emulator from firebase.json)
 * and Google sign-in through the Auth emulator. Skipped unless both emulators are running:
 *
 *   bunx firebase-tools emulators:exec --only auth,firestore --project demo-coldforge \
 *     "bun test apps/app/src/firebase/emulator.test.ts"
 */
import { describe, expect, test } from "bun:test";
import { emptyChanges } from "@cold-forge/sync";
import { deleteApp, initializeApp } from "firebase/app";
import { GoogleAuthProvider, connectAuthEmulator, getAuth, signInWithCredential } from "firebase/auth";
import { connectFirestoreEmulator, initializeFirestore, memoryLocalCache } from "firebase/firestore";
import { createFirestoreTransport } from "../lib/sync/firestoreTransport.ts";
import { toSyncChanges } from "../lib/sync/mapping.ts";
import { makeData } from "../lib/sync/testkit.ts";
import { firestorePort } from "./port.ts";
import { setCheckIn } from "../lib/model.ts";

const FS = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const suite = FS && AUTH ? describe : describe.skip;

let n = 0;
/** A "device": its own Firebase app, signed in with Google (the Auth emulator accepts unsigned tokens). */
async function device(sub: string, opts: { verified?: boolean } = {}) {
  const app = initializeApp({ projectId: "demo-coldforge", apiKey: "demo-key", authDomain: "localhost" }, `device-${++n}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH}`, { disableWarnings: true });
  const db = initializeFirestore(app, { localCache: memoryLocalCache() });
  const [host, port] = FS!.split(":");
  connectFirestoreEmulator(db, host!, Number(port));
  const idToken = JSON.stringify({ sub, email: `${sub}@gmail.com`, email_verified: opts.verified ?? true });
  const cred = await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
  const uid = cred.user.uid;
  return { app, uid, transport: createFirestoreTransport(firestorePort(db), uid, { pageSize: 3 }) };
}

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

suite("Firestore transport + rules (emulators)", () => {
  test("push, paged pull, last-write-wins, realtime and full deletion", async () => {
    const sub = `user${Date.now()}`;
    const a = await device(sub);
    const b = await device(sub);
    expect(a.uid).toBe(b.uid);

    // Device A: first sync = pull (empty) then push everything.
    const data = makeData({ habits: 4, now: iso(3_600_000) });
    const changes = toSyncChanges(data);
    changes.checkIns = [{ habitId: data.habits[0]!.id, date: "2026-09-30", done: true, updatedAt: iso(3_000_000) }];
    expect((await a.transport.pull(null)).ok).toBe(true);
    const pushed = await a.transport.push(changes);
    expect(pushed).toEqual({ ok: true, value: undefined });

    // Device B pulls it all back in pages of 3 (ties on syncedAt across one batch).
    let cursor: string | null = null;
    const got = emptyChanges();
    for (let i = 0; i < 20; i++) {
      const r = await b.transport.pull(cursor);
      if (!r.ok) throw new Error(`pull failed: ${r.error.kind}`);
      got.arcs.push(...r.value.changes.arcs);
      got.habits.push(...r.value.changes.habits);
      got.checkIns.push(...r.value.changes.checkIns);
      if (r.value.changes.profile) got.profile = r.value.changes.profile;
      cursor = r.value.cursor;
      if (!r.value.hasMore) break;
    }
    expect(got.arcs).toEqual(changes.arcs);
    expect(got.habits.map((h) => h.id).sort()).toEqual(changes.habits.map((h) => h.id).sort());
    expect(got.checkIns).toEqual(changes.checkIns);
    expect(got.profile).toEqual(changes.profile);

    // Realtime on A sees B's next change.
    const seen: string[] = [];
    const stop = a.transport.subscribe!(cursor, (page) => seen.push(...page.changes.checkIns.map((c) => c.date)), () => undefined);
    const next = setCheckIn(data, data.habits[1]!.id, "2026-09-29", true, iso(1_000));
    await b.transport.pull(cursor);
    expect(await b.transport.push({ ...emptyChanges(), checkIns: toSyncChanges(next).checkIns.filter((c) => c.date === "2026-09-29") })).toEqual({
      ok: true,
      value: undefined,
    });
    for (let i = 0; i < 50 && !seen.includes("2026-09-29"); i++) await new Promise((r) => setTimeout(r, 100));
    stop();
    expect(seen).toContain("2026-09-29");

    // Last-write-wins in the rules: a stale write is refused as a whole batch.
    const stale = { ...emptyChanges(), arcs: [{ ...changes.arcs[0]!, why: "stale", updatedAt: iso(7_200_000) }] };
    expect(await a.transport.push(stale)).toEqual({ ok: false, error: { kind: "rejected" } });

    // Account deletion removes every document.
    expect(await a.transport.deleteEverything()).toEqual({ ok: true, value: undefined });
    const after = await b.transport.pull(null);
    expect(after.ok && after.value.changes).toEqual(emptyChanges());
    await Promise.all([deleteApp(a.app), deleteApp(b.app)]);
  }, 60_000);

  test("an unverified Google email can't write", async () => {
    const d = await device(`unverified${Date.now()}`, { verified: false });
    expect(await d.transport.push(toSyncChanges(makeData({ now: iso(60_000) })))).toEqual({ ok: false, error: { kind: "rejected" } });
    await deleteApp(d.app);
  }, 30_000);
});
