#!/usr/bin/env bun
/**
 * Grants or revokes the `admin` custom claim. This is how the FIRST admin is created (the admin
 * panel can only promote people once someone is already an admin), and the break-glass tool if
 * every admin loses access.
 *
 *   bun scripts/set-admin.ts --project coldforge-work --email you@gmail.com
 *   bun scripts/set-admin.ts --project coldforge-work --email old@gmail.com --revoke
 *
 * Credentials: Application Default Credentials only, never a key file in the repo:
 *   gcloud auth application-default login
 *   gcloud auth application-default set-quota-project coldforge-work
 * (or GOOGLE_APPLICATION_CREDENTIALS=/path/outside/the/repo.json). The account needs
 * "Firebase Authentication Admin" (roles/firebaseauth.admin) or Owner on the project.
 * With FIREBASE_AUTH_EMULATOR_HOST set, it talks to the Auth emulator instead.
 *
 * The user must have signed in to the app/admin once (so the account exists) with Google and a
 * verified email. After granting, they must sign out and in again (or wait up to 1h) to get a
 * token that carries the claim.
 */
import { createRequire } from "node:module";
import { createInterface } from "node:readline/promises";

// firebase-admin is a dependency of apps/functions (isolated install), so resolve it from there.
const require = createRequire(new URL("../apps/functions/package.json", import.meta.url));

interface Args {
  project: string;
  email: string;
  revoke: boolean;
  yes: boolean;
}

const USAGE = "Usage: bun scripts/set-admin.ts --project <firebase-project-id> --email <email> [--revoke] [--yes]";

function fail(message: string): never {
  console.error(`error: ${message}\n${USAGE}`);
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = { revoke: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (!v || v.startsWith("--")) fail(`${arg} needs a value`);
      return v;
    };
    if (arg === "--project") out.project = value();
    else if (arg === "--email") out.email = value().trim().toLowerCase();
    else if (arg === "--revoke") out.revoke = true;
    else if (arg === "--yes") out.yes = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else fail(`unknown argument: ${arg}`);
  }
  if (!out.project) fail("--project is required (no default, on purpose)");
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(out.project)) fail(`invalid project id: ${out.project}`);
  if (!out.email) fail("--email is required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) fail(`invalid email: ${out.email}`);
  return out as Args;
}

const args = parseArgs(process.argv.slice(2));

const { initializeApp, applicationDefault } = require("firebase-admin/app") as typeof import("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth") as typeof import("firebase-admin/auth");

const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
initializeApp(emulator ? { projectId: args.project } : { projectId: args.project, credential: applicationDefault() });
const auth = getAuth();

let user;
try {
  user = await auth.getUserByEmail(args.email);
} catch (error) {
  const code = (error as { code?: string }).code;
  if (code === "auth/user-not-found") fail(`no account with email ${args.email} in ${args.project}. Sign in once first.`);
  console.error(`error: could not read the account (${code ?? (error as Error).message}).`);
  console.error("Check `gcloud auth application-default login`, the quota project, and your IAM role.");
  process.exit(1);
}

const claims: Record<string, unknown> = { ...(user.customClaims ?? {}) };
const isAdmin = claims.admin === true;
const providers = user.providerData.map((p) => p.providerId);

console.log(`project:   ${args.project}${emulator ? ` (emulator ${emulator})` : ""}`);
console.log(`account:   ${user.email}  uid=${user.uid}`);
console.log(`verified:  ${user.emailVerified}   disabled: ${user.disabled}   providers: ${providers.join(", ") || "none"}`);
console.log(`admin now: ${isAdmin}`);
console.log(`action:    ${args.revoke ? "REVOKE admin" : "GRANT admin"}`);

if (args.revoke && !isAdmin) {
  console.log("Nothing to do: the account is not an admin.");
  process.exit(0);
}
if (!args.revoke) {
  if (isAdmin) {
    console.log("Nothing to do: the account is already an admin.");
    process.exit(0);
  }
  if (user.disabled) fail("refusing to grant admin to a disabled account");
  if (!user.emailVerified) fail("refusing to grant admin to an account without a verified email");
  if (!providers.includes("google.com")) {
    fail("refusing: the account has no Google sign-in (the admin functions require Google sign-in)");
  }
}

if (!args.yes) {
  if (!process.stdin.isTTY) fail("not a TTY: re-run with --yes to confirm non-interactively");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`Type the project id (${args.project}) to confirm: `)).trim();
  rl.close();
  if (answer !== args.project) fail("confirmation did not match; nothing changed");
}

if (args.revoke) delete claims.admin;
else claims.admin = true;
await auth.setCustomUserClaims(user.uid, Object.keys(claims).length ? claims : null);
if (args.revoke) await auth.revokeRefreshTokens(user.uid);

const after = await auth.getUser(user.uid);
console.log(`done:      admin=${after.customClaims?.admin === true}${args.revoke ? " (all sessions revoked)" : ""}`);
if (!args.revoke) console.log("The user must sign out and back in to the admin panel to pick up the claim.");
process.exit(0);
