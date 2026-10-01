/**
 * End-to-end check against the Firebase emulators (Auth + Firestore + Functions):
 *
 *   bun run test:emulators        # from apps/functions (builds first)
 *
 * Creates Google-provider users in the Auth emulator and calls the deployed-to-emulator callables over
 * HTTP exactly like the web SDK does. Admins are whoever is in the emulator allowlist,
 * ADMIN_EMULATOR_ALLOWED_EMAILS in apps/functions/.env.demo-coldforge
 * (" Admin@Example.com ,second-admin@example.com"): no custom claims anywhere.
 * Not a `*.test.ts` file on purpose: the root `bun test` must not need emulators.
 */
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT = process.env.GCLOUD_PROJECT ?? "demo-coldforge";
const REGION = process.env.ADMIN_REGION ?? "us-central1";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const FUNCTIONS_HOST = process.env.FUNCTIONS_EMULATOR_HOST ?? "127.0.0.1:5001";
if (!AUTH_HOST || !process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("Run through `firebase emulators:exec` (emulator env vars missing).");
  process.exit(2);
}

initializeApp({ projectId: PROJECT });
const auth = getAuth();
const db = getFirestore();

let failures = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || extra === undefined ? "" : ` -> ${JSON.stringify(extra)}`}`);
  if (!ok) failures++;
}

/** Signs in through the Auth emulator's fake Google IdP and returns an ID token. */
async function googleSignIn(sub: string, email: string, emailVerified = true): Promise<{ idToken: string; uid: string }> {
  const idToken = JSON.stringify({ sub, email, email_verified: emailVerified, name: sub });
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestUri: "http://localhost", postBody: `id_token=${encodeURIComponent(idToken)}&providerId=google.com`, returnSecureToken: true }),
  });
  const body = (await res.json()) as { idToken: string; localId: string };
  return { idToken: body.idToken, uid: body.localId };
}

/** Email/password sign-in (a different provider) through the Auth emulator. */
async function passwordSignIn(email: string, password: string): Promise<{ idToken: string; uid: string }> {
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = (await res.json()) as { idToken: string; localId: string };
  return { idToken: body.idToken, uid: body.localId };
}

async function call(name: string, token: string | null, data: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://${FUNCTIONS_HOST}/${PROJECT}/${REGION}/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ data }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const denied = (r: { status: number; body: any }) => r.status === 403 && r.body?.error?.status === "PERMISSION_DENIED";

// Upper-case email from Google: the allowlist entry is " Admin@Example.com " (normalization both ways).
const admin = await googleSignIn("admin-sub", "ADMIN@example.com");
const adminToken = admin.idToken;
const victim = await googleSignIn("victim-sub", "victim@example.com");

await db.doc(`users/${victim.uid}`).set({ displayName: "Victim", locale: "en", currentArcId: "a1", updatedAt: new Date().toISOString() });
await db.doc(`users/${victim.uid}/arcs/a1`).set({ id: "a1" });
await db.doc(`users/${victim.uid}/habits/h1`).set({ id: "h1", arcId: "a1" });
await db.doc(`users/${victim.uid}/checkIns/h1_2026-10-01`).set({ habitId: "h1", date: "2026-10-01", done: true });

let r = await call("adminWhoAmI", adminToken, {});
check("whoAmI: allowlisted Google admin (email case/whitespace normalized)", r.status === 200 && r.body?.result?.email === "admin@example.com" && r.body.result.isAdmin === true, r);
r = await call("adminWhoAmI", victim.idToken, {});
check("whoAmI: verified Google user outside the allowlist is denied", denied(r), r);

// A custom `admin` claim grants nothing any more.
await auth.setCustomUserClaims(victim.uid, { admin: true });
r = await call("adminStats", (await googleSignIn("victim-sub", "victim@example.com")).idToken, {});
check("admin custom claim is ignored", denied(r), r);
await auth.setCustomUserClaims(victim.uid, null);

// second-admin@example.com is allowlisted. First try it unverified, then with a password sign-in.
const unverified = await googleSignIn("unverified-sub", "Second-Admin@example.com", false);
r = await call("adminWhoAmI", unverified.idToken, {});
check("allowlisted but unverified email is denied", denied(r), r);
await auth.deleteUser(unverified.uid);

const pw = await auth.createUser({ email: "second-admin@example.com", password: "correct-horse-1", emailVerified: true });
r = await call("adminWhoAmI", (await passwordSignIn("second-admin@example.com", "correct-horse-1")).idToken, {});
check("allowlisted and verified, but password sign-in, is denied", denied(r), r);
await auth.deleteUser(pw.uid);

// The real second admin (Google): used below for target-is-admin and stale-token checks.
const second = await googleSignIn("second-sub", "second-admin@example.com");
r = await call("adminWhoAmI", second.idToken, {});
check("second allowlisted admin passes", r.status === 200, r);

r = await call("adminStats", null, {});
check("unauthenticated is refused", r.status === 401 && r.body?.error?.status === "UNAUTHENTICATED", r);
r = await call("adminStats", victim.idToken, {});
check("non-admin is refused", r.status === 403 && r.body?.error?.status === "PERMISSION_DENIED", r);

r = await call("adminStats", adminToken, {});
check(
  "stats",
  r.status === 200 && r.body.result.totalUsers === 3 && r.body.result.admins === 2 && r.body.result.totals.checkIns === 1 && r.body.result.active7d === 1,
  r,
);

r = await call("adminListUsers", adminToken, { pageSize: 10 });
const row = r.body?.result?.users?.find((u: { uid: string }) => u.uid === victim.uid);
check("list users with counts", r.status === 200 && row?.counts?.habits === 1 && row.providers.includes("google.com") && row.isAdmin === false, r);
const secondRow = r.body?.result?.users?.find((u: { uid: string }) => u.uid === second.uid);
check("isAdmin is computed from the allowlist", secondRow?.isAdmin === true, secondRow);

r = await call("adminListUsers", adminToken, { pageSize: 1000 });
check("pageSize is bounded", r.status === 400 && r.body?.error?.status === "INVALID_ARGUMENT", r);

r = await call("adminGetUser", adminToken, { uid: victim.uid });
check("get user with profile", r.status === 200 && r.body.result.profile.displayName === "Victim", r);

r = await call("adminSetDisabled", adminToken, { uid: admin.uid, disabled: true, reason: "self" });
check("cannot disable self", r.status === 400 && r.body?.error?.details?.reason === "self-action", r);

r = await call("adminSetDisabled", adminToken, { uid: second.uid, disabled: true, reason: "rogue admin" });
check("cannot disable an allowlisted account", r.status === 400 && r.body?.error?.details?.reason === "target-is-admin", r);
r = await call("adminDeleteUser", adminToken, { uid: second.uid, confirm: "second-admin@example.com" });
check("cannot delete an allowlisted account", r.status === 400 && r.body?.error?.details?.reason === "target-is-admin", r);
check("allowlisted account untouched", (await auth.getUser(second.uid)).disabled === false);

r = await call("adminSetAdmin", adminToken, { uid: victim.uid, admin: true });
check("adminSetAdmin no longer exists", r.status === 404, r.status);

r = await call("adminSetDisabled", adminToken, { uid: victim.uid, disabled: true, reason: "abuse test" });
check("disable", r.status === 200 && r.body.result.user.disabled === true, r);
check("disabled in Auth", (await auth.getUser(victim.uid)).disabled === true);
check("disable writes blocked/{uid} (rules refuse the old token at once)", (await db.doc(`blocked/${victim.uid}`).get()).get("reason") === "disabled");

r = await call("adminDeleteUser", adminToken, { uid: victim.uid, confirm: "wrong@example.com" });
check("delete needs typed email", r.status === 400 && r.body?.error?.details?.reason === "confirm-mismatch", r);

r = await call("adminDeleteUser", adminToken, { uid: victim.uid, confirm: "VICTIM@example.com" });
check("delete", r.status === 200, r);
check("data gone", (await db.collection(`users/${victim.uid}/checkIns`).count().get()).data().count === 0);
const block = await db.doc(`blocked/${victim.uid}`).get();
check("deleted account stays blocked, with a delayed second sweep", block.get("reason") === "deleted" && block.get("sweepAfter") != null);
check("account gone", await auth.getUser(victim.uid).then(() => false, () => true));

r = await call("adminListAuditLog", adminToken, {});
const entries: { action: string; outcome: string; code: string | null }[] = r.body?.result?.entries ?? [];
const actions = entries.map((e) => e.action);
check("audit log", r.status === 200 && actions[0] === "user.delete" && actions.includes("user.disable"), actions);
check("user views are audited", actions.includes("user.view"), actions);
check(
  "refusals are audited with their code",
  ["self-action", "confirm-mismatch", "target-is-admin"].every((c) => entries.some((e) => e.outcome === "refused" && e.code === c)),
  entries,
);

// Quota triggers (H1): every arc/habit create bumps quota/{uid}; over QUOTAS.arcs (50) → blocked.
const hog = "quota-hog";
const batch = db.batch();
for (let i = 0; i < 51; i++) batch.set(db.doc(`users/${hog}/arcs/a${i}`), { id: `a${i}` });
await batch.commit();
let arcsCounted = 0;
for (let i = 0; i < 80 && arcsCounted < 51; i++) {
  await Bun.sleep(250);
  arcsCounted = ((await db.doc(`quota/${hog}`).get()).get("arcs") as number | undefined) ?? 0;
}
check("arc creates are counted in quota/{uid}", arcsCounted === 51, arcsCounted);
check("over QUOTAS.arcs → blocked/{uid} {reason: quota}", (await db.doc(`blocked/${hog}`).get()).get("reason") === "quota");

// onUserDeleted: deleting an account anywhere (here: directly via the Admin SDK) removes its data.
const other = await googleSignIn("other-sub", "other@example.com");
await db.doc(`users/${other.uid}`).set({ displayName: "Other", updatedAt: new Date().toISOString() });
await db.doc(`users/${other.uid}/arcs/a1`).set({ id: "a1" });
await auth.deleteUser(other.uid);
let remaining = 1;
for (let i = 0; i < 40 && remaining > 0; i++) {
  await Bun.sleep(250);
  remaining = (await db.collection(`users/${other.uid}/arcs`).count().get()).data().count;
}
// Known sandbox limitation: the Auth emulator's onDelete multicast may be blocked by the proxy
// here; the trigger's logic (block, then erase) is unit-tested in src/quota.test.ts.
check("onUserDeleted removes data", remaining === 0);
check("onUserDeleted leaves blocked/{uid} {reason: deleted}", (await db.doc(`blocked/${other.uid}`).get()).get("reason") === "deleted");

// Stale tokens: the still-valid ID token must stop working as soon as the live account changes.
await auth.revokeRefreshTokens(second.uid);
r = await call("adminWhoAmI", second.idToken, {});
check("token issued before a session revocation is refused", r.status === 401 && r.body?.error?.details?.reason === "session-revoked", r);
const secondFresh = (await googleSignIn("second-sub", "second-admin@example.com")).idToken;
r = await call("adminWhoAmI", secondFresh, {});
check("a fresh sign-in after the revocation works", r.status === 200, r);
await auth.updateUser(second.uid, { disabled: true }); // e.g. from the Firebase console
r = await call("adminWhoAmI", secondFresh, {});
check("a stale token after the account was disabled is refused", denied(r), r);

console.log(failures === 0 ? "\nall emulator checks passed" : `\n${failures} emulator check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
