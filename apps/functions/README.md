# @cold-forge/functions

Cloud Functions (Node 22) for COLD FORGE: the admin callables, the `onUserDeleted` cleanup trigger
and the per-user quota triggers/jobs.
Data model: [`docs/firebase.md`](../../docs/firebase.md).

| Export | Kind | What |
| --- | --- | --- |
| `adminWhoAmI` | callable (v2) | `{}` → `{email, isAdmin: true}` for an admin, otherwise `permission-denied` (the panel calls it after sign-in and on every token refresh) |
| `adminListUsers` | callable | `{pageToken?, pageSize<=100, query?}` → users + per-user arc/habit/check-in counts + `isAdmin` (email in the allowlist) |
| `adminGetUser` | callable | `{uid}` → account, `users/{uid}` profile, counts (audited as `user.view`) |
| `adminSetDisabled` | callable | `{uid, disabled, reason}`; disabling writes `blocked/{uid}` and revokes refresh tokens; enabling lifts a `disabled` block only |
| `adminDeleteUser` | callable | `{uid, confirm: <their email>, reason?}` → `blocked/{uid}` (deleted), lock, `recursiveDelete(users/{uid})`, delete account |
| `adminStats` | callable | totals, sign-ups 7/30 d, active 7 d (profile `updatedAt`), content totals |
| `adminListAuditLog` | callable | `{pageToken?, pageSize?}` → `adminAuditLog`, newest first |
| `onUserDeleted` | Auth trigger (v1 API) | `blocked/{uid}` {reason: deleted}, then `recursiveDelete(users/{uid})`, whenever an account is deleted |
| `quotaOnArcCreated`, `quotaOnHabitCreated` | Firestore `onDocumentCreated` (v2) | `quota/{uid}.{arcs,habits}` += 1; over `QUOTAS` → `blocked/{uid}` {reason: quota} |
| `quotaRecountCheckIns` | scheduled, daily 03:17 UTC | `count()` of each active / least-recently-counted user's check-ins; over `QUOTAS.checkIns` → blocked; logs > 5000 new/day |
| `sweepDeletedAccounts` | scheduled, hourly | second `recursiveDelete` of accounts deleted > 1 h ago (`blocked/{uid}.sweepAfter`) |

`QUOTAS` (50 arcs, 500 habits, 50 000 check-ins) lives in `packages/sync/src/quotas.ts`, imported
directly (dependency-free) and bundled by `build.ts`. `quota/*` and `blocked/*` are not readable or
writable by clients; the Firestore rules refuse every read and write of a uid that has `blocked/{uid}`.

The wire contract is `src/api.ts` (type-only; `apps/admin` imports it).

## Admin model: the allowlist is the role

A caller is an admin **iff** their ID token has `email_verified === true`,
`firebase.sign_in_provider === "google.com"`, and their email (trimmed, lower-cased) is in the
`ADMIN_ALLOWED_EMAILS` secret (comma-separated, normalized the same way). There is no custom claim
(an `admin` claim, if an account still has one, is ignored), no "make admin" callable and no script:
admins are managed only through the secret.

```sh
bunx firebase-tools@15.32.1 functions:secrets:set ADMIN_ALLOWED_EMAILS --project coldforge-work   # you@gmail.com,other@gmail.com
bunx firebase-tools@15.32.1 deploy --only functions --project coldforge-work                      # or push to main (CI deploys)
```

Secrets are read when an instance starts, so a change takes effect after the redeploy (or as new
instances start). Removing someone: set the list without them and redeploy; their next call is
refused by the allowlist check (and the panel signs them out on its next `adminWhoAmI`).

## Security model

Every callable runs, in order:

1. **Token check** (`requireAdmin`, pure, no I/O): verified ID token, verified email, Google sign-in,
   normalized email in `ADMIN_ALLOWED_EMAILS`. **Fail closed:** with the allowlist empty or unset
   every admin call is refused (`allowlist-not-configured`). Non-admins are rejected before any
   Firestore/Auth call.
2. **Rate limit**: per admin, 60 reads/min and 10 mutations/min, fixed window stored in
   `adminRateLimits/{uid}_{bucket}` via a transaction (holds across instances; an in-memory
   counter would reset on every cold start). Docs carry `expiresAt` for an optional TTL policy.
3. **Live account check** (`assertLiveAdmin`): re-reads the caller's Auth record and requires it to
   be enabled, `tokensValidAfterTime <= auth_time` (revoked sessions refused), its email equal to the
   token's and still verified, and still in the allowlist. A disabled or revoked admin is refused
   immediately instead of when their 1 h token expires.
4. **Strict input validation** (`src/validate.ts`): plain objects only, unknown keys rejected,
   uids `^[A-Za-z0-9_:-]{1,128}$` (no `/` or `.`, they become Firestore paths), bounded page sizes,
   page-token formats, reasons 3–500 chars without control characters.
5. **Action rules**: never on yourself (`self-action`); accounts whose email is in the allowlist
   can't be disabled or deleted (`target-is-admin`: remove them from the secret first); delete needs
   the typed email and a sign-in from the last 30 min (`recent-login-required` → the panel
   re-authenticates).
6. **Audit**: every mutation (outcome `ok` or `error`), every **refused** attempt (outcome `refused` with
   `code`: `self-action`, `target-is-admin`, `confirm-mismatch`, `recent-login-required`, `rate-limited`)
   and every single-account view (`adminGetUser` → action `user.view`) writes `adminAuditLog/{autoId}`
   `{actorUid, actorEmail, action, targetUid, targetEmail, reason, outcome, code, at}`. List pages
   (`adminListUsers`, `adminStats`, `adminListAuditLog`) and `adminWhoAmI` are not audited. Entries
   from the removed `admin.grant` / `admin.revoke` actions read back as `unknown`.

Errors are `HttpsError`s with `details.reason` for deliberate refusals; anything unexpected becomes
`internal` without the underlying message. Logs carry only `action`, `actorUid`, outcome/code: never
tokens, request bodies or emails of targets.

Instances are capped (`maxInstances: 3`, 256 MiB) to bound cost if someone hammers the endpoints.

## Params (`.env.<projectId>`) and the allowlist secret

See `.env.example`. `.env.coldforge-work` is committed (nothing secret). `.env.demo-coldforge`
(committed) holds the emulator params; `.env.local` (gitignored) can override them locally.

- `ADMIN_REGION` (default `us-central1`): must match `VITE_FUNCTIONS_REGION` in `apps/admin`.
- `ADMIN_ORIGIN`: CORS origin for the callables (`https://admin.coldforge.work`).
- `ADMIN_ENFORCE_APP_CHECK` (default `false`): set `true` only after enabling App Check in the admin
  panel (`VITE_APPCHECK_SITE_KEY`, see `docs/deploy.md` → App Check).
- `ADMIN_ALLOWED_EMAILS` — **a Cloud Secret Manager secret, not a `.env` value**, and the whole
  admin role (see above). The repo is public and the value names the owner, so it is deployed
  without being committed: firebase-functions v7 `defineSecret` binds it to the callables at deploy
  time. An interactive deploy prompts for it when missing; a non-interactive one fails and prints the
  `functions:secrets:set` command. Don't also put `ADMIN_ALLOWED_EMAILS=` in a `.env` file (a secret
  and an env var can't share a name).
- **Emulator only:** `.env.demo-coldforge` (committed, used only for the offline `demo-coldforge`
  project) sets `ADMIN_EMULATOR_ALLOWED_EMAILS=" Admin@Example.com ,second-admin@example.com"`. It is
  read only when `FUNCTIONS_EMULATOR=true` and the secret has no value (no `.secret.local`), and is
  ignored in production. Sign in as `admin@example.com` in the Auth emulator's fake Google picker to
  use the panel locally; override it in `.env.local`, or set `ADMIN_ALLOWED_EMAILS` in
  `.secret.local` (both gitignored). Empty there too = everything refused, as in production.

`ADMIN_ENFORCE_APP_CHECK` is read from `process.env` when the module loads rather than passed to
`enforceAppCheck` as a param: firebase-functions 7.4 calls `.value()` on such a param at load time,
which printed `params.ADMIN_ENFORCE_APP_CHECK.value() invoked during function deployment` on every
deploy. The param is still declared (validation, default `false`) and the value is parsed exactly as
`BooleanParam` does (`=== "true"`).

## Build and deploy

Firebase deploys this folder and Cloud Build runs `npm ci` here, where `workspace:*` can't resolve.
So `build.ts` bundles `src/index.ts` (and any `@cold-forge/*` workspace code it imports) into
`lib/index.js` with Bun, leaving only `firebase-functions` / `firebase-admin` external; the build
fails if anything else would be imported at runtime. `package.json` has an empty `gcp-build` so
Cloud Build doesn't try to rebuild, and `package-lock.json` pins the two runtime deps for `npm ci`.

Normally **GitHub Actions deploys** (`.github/workflows/firebase-deploy.yml`, every push to `main`
touching `firebase/`, `apps/functions/`, `packages/sync|core` or `bun.lock`; see `docs/deploy.md`).
Manual fallback:

```sh
bun run --cwd apps/functions build      # → lib/index.js
bunx firebase-tools@15.32.1 deploy --only firestore,functions --project coldforge-work --force
```

With the `predeploy` hook in `firebase.json` the build runs automatically on deploy. `--force`
deletes functions that are no longer in the source without prompting (e.g. the removed
`adminSetAdmin`).

`package.json` carries an npm `overrides` entry (`uuid ^11.1.1`, GHSA-w5hq-g745-h8pq via gaxios), so
`npm audit` on the deployed lockfile is clean. After changing dependencies, refresh the npm lockfile
outside the workspace:

```sh
d=$(mktemp -d) && cp apps/functions/package.json "$d" && (cd "$d" && npm install --package-lock-only --ignore-scripts) && cp "$d/package-lock.json" apps/functions/
```

## Tests

- `bun test src`: validation, guard, rate limit, adapters and every use case against in-memory
  Auth/Firestore fakes (`src/testing/fakes.ts`).
- `bun run test:emulators`: builds, starts the Auth/Firestore/Functions emulators and calls the real
  callables over HTTP (`integration/run.ts`), including the allowlist model (non-allowlisted,
  unverified and password-provider tokens denied, a leftover `admin` claim ignored, email
  normalization, stale tokens after revocation/disable, `target-is-admin`), `blocked/{uid}` on disable/delete, refused
  attempts in the audit log, the quota trigger and `onUserDeleted`. Needs Java 21. Behind an HTTP proxy,
  unset `HTTPS_PROXY`/`HTTP_PROXY` (and lower-case variants) for this command: firebase-tools sends its emulator-to-emulator
  calls (Firestore trigger registration, the Auth onDelete multicast) through the proxy, ignoring
  `NO_PROXY`, and they fail with "request blocked".
- `src/quota.test.ts`: triggers, recount, `onUserDeleted` (block, then erase) and the delayed sweep with fakes.
