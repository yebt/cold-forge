/**
 * End-to-end check against the Firebase emulators (Auth + Firestore + Functions):
 *
 *   bun run test:emulators        # from apps/functions (builds first)
 *
 * Creates Google-provider users in the Auth emulator, grants the admin claim with firebase-admin,
 * then calls the deployed-to-emulator callables over HTTP exactly like the web SDK does.
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
async function googleSignIn(sub: string, email: string): Promise<{ idToken: string; uid: string }> {
  const idToken = JSON.stringify({ sub, email, email_verified: true, name: sub });
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestUri: "http://localhost", postBody: `id_token=${encodeURIComponent(idToken)}&providerId=google.com`, returnSecureToken: true }),
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

const admin = await googleSignIn("admin-sub", "admin@example.com");
const victim = await googleSignIn("victim-sub", "victim@example.com");
await auth.setCustomUserClaims(admin.uid, { admin: true });
// Fresh token so it carries the claim.
const adminToken = (await googleSignIn("admin-sub", "admin@example.com")).idToken;

await db.doc(`users/${victim.uid}`).set({ displayName: "Victim", locale: "en", currentArcId: "a1", updatedAt: new Date().toISOString() });
await db.doc(`users/${victim.uid}/arcs/a1`).set({ id: "a1" });
await db.doc(`users/${victim.uid}/habits/h1`).set({ id: "h1", arcId: "a1" });
await db.doc(`users/${victim.uid}/checkIns/h1_2026-10-01`).set({ habitId: "h1", date: "2026-10-01", done: true });

let r = await call("adminStats", null, {});
check("unauthenticated is refused", r.status === 401 && r.body?.error?.status === "UNAUTHENTICATED", r);
r = await call("adminStats", victim.idToken, {});
check("non-admin is refused", r.status === 403 && r.body?.error?.status === "PERMISSION_DENIED", r);

r = await call("adminStats", adminToken, {});
check("stats", r.status === 200 && r.body.result.totalUsers === 2 && r.body.result.totals.checkIns === 1 && r.body.result.active7d === 1, r);

r = await call("adminListUsers", adminToken, { pageSize: 10 });
const row = r.body?.result?.users?.find((u: { uid: string }) => u.uid === victim.uid);
check("list users with counts", r.status === 200 && row?.counts?.habits === 1 && row.providers.includes("google.com"), r);

r = await call("adminListUsers", adminToken, { pageSize: 1000 });
check("pageSize is bounded", r.status === 400 && r.body?.error?.status === "INVALID_ARGUMENT", r);

r = await call("adminGetUser", adminToken, { uid: victim.uid });
check("get user with profile", r.status === 200 && r.body.result.profile.displayName === "Victim", r);

r = await call("adminSetDisabled", adminToken, { uid: admin.uid, disabled: true, reason: "self" });
check("cannot disable self", r.status === 400 && r.body?.error?.details?.reason === "self-action", r);

r = await call("adminSetDisabled", adminToken, { uid: victim.uid, disabled: true, reason: "abuse test" });
check("disable", r.status === 200 && r.body.result.user.disabled === true, r);
check("disabled in Auth", (await auth.getUser(victim.uid)).disabled === true);

r = await call("adminDeleteUser", adminToken, { uid: victim.uid, confirm: "wrong@example.com" });
check("delete needs typed email", r.status === 400 && r.body?.error?.details?.reason === "confirm-mismatch", r);

r = await call("adminDeleteUser", adminToken, { uid: victim.uid, confirm: "VICTIM@example.com" });
check("delete", r.status === 200, r);
check("data gone", (await db.collection(`users/${victim.uid}/checkIns`).count().get()).data().count === 0);
check("account gone", await auth.getUser(victim.uid).then(() => false, () => true));

r = await call("adminListAuditLog", adminToken, {});
const actions = (r.body?.result?.entries ?? []).map((e: { action: string }) => e.action);
check("audit log", r.status === 200 && actions[0] === "user.delete" && actions.includes("user.disable"), actions);

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
check("onUserDeleted removes data", remaining === 0);

// Demote the admin server-side: the still-valid token must stop working immediately.
await auth.setCustomUserClaims(admin.uid, null);
r = await call("adminStats", adminToken, {});
check("demoted admin's old token is refused", r.status === 403, r);

console.log(failures === 0 ? "\nall emulator checks passed" : `\n${failures} emulator check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
