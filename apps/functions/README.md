# @cold-forge/functions

Cloud Functions (Node 22) for COLD FORGE: the admin callables, the `onUserDeleted` cleanup trigger
and the per-user quota triggers/jobs.
Data model: [`docs/firebase.md`](../../docs/firebase.md).

| Export | Kind | What |
| --- | --- | --- |
| `adminListUsers` | callable (v2) | `{pageToken?, pageSize<=100, query?}` → users + per-user arc/habit/check-in counts |
| `adminGetUser` | callable | `{uid}` → account, `users/{uid}` profile, counts (audited as `user.view`) |
| `adminSetDisabled` | callable | `{uid, disabled, reason}`; disabling writes `blocked/{uid}` and revokes refresh tokens; enabling lifts a `disabled` block only |
| `adminDeleteUser` | callable | `{uid, confirm: <their email>, reason?}` → `blocked/{uid}` (deleted), lock, `recursiveDelete(users/{uid})`, delete account |
| `adminSetAdmin` | callable | `{uid, admin, reason?}`; revoking also revokes the target's sessions |
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

## Security model

Every callable runs, in order:

1. **Token check** (`requireAdmin`, pure, no I/O): verified ID token with `admin === true`,
   `email_verified === true`, Google sign-in, and email in `ADMIN_ALLOWED_EMAILS`. **Fail closed:** with
   the allowlist empty every admin call is refused (`allowlist-not-configured`), unless
   `ADMIN_ALLOW_ANY_ADMIN=true` (or in the Functions emulator). Non-admins are rejected before any
   Firestore/Auth call.
2. **Rate limit**: per admin, 60 reads/min and 10 mutations/min, fixed window stored in
   `adminRateLimits/{uid}_{bucket}` via a transaction (holds across instances; an in-memory
   counter would reset on every cold start). Docs carry `expiresAt` for an optional TTL policy.
3. **Live account check** (`assertLiveAdmin`): re-reads the caller's Auth record, so a demoted,
   disabled or session-revoked admin is refused immediately instead of when their 1 h token expires.
4. **Strict input validation** (`src/validate.ts`): plain objects only, unknown keys rejected,
   uids `^[A-Za-z0-9_:-]{1,128}$` (no `/` or `.`, they become Firestore paths), bounded page sizes,
   page-token formats, reasons 3–500 chars without control characters.
5. **Action rules**: never on yourself (so at least one admin always remains: the caller); admins
   can't be disabled/deleted until demoted; delete needs the typed email; delete and admin changes
   need a sign-in from the last 30 min (`recent-login-required` → the panel re-authenticates);
   a concurrent mutual demotion is detected and rolled back.
6. **Audit**: every mutation (outcome `ok` or `error`), every **refused** attempt (outcome `refused` with
   `code`: `self-action`, `target-is-admin`, `confirm-mismatch`, `recent-login-required`, `rate-limited`)
   and every single-account view (`adminGetUser` → action `user.view`) writes `adminAuditLog/{autoId}`
   `{actorUid, actorEmail, action, targetUid, targetEmail, reason, outcome, code, at}`. List pages
   (`adminListUsers`, `adminStats`, `adminListAuditLog`) are not audited.

Errors are `HttpsError`s with `details.reason` for deliberate refusals; anything unexpected becomes
`internal` without the underlying message. Logs carry only `action`, `actorUid`, outcome/code: never
tokens, request bodies or emails of targets.

Instances are capped (`maxInstances: 3`, 256 MiB) to bound cost if someone hammers the endpoints.

## Params (`.env.<projectId>`) and the allowlist secret

See `.env.example`. `.env.coldforge-work` is committed (nothing secret). `.env.local` is for the
emulator only (`ADMIN_ORIGIN=http://localhost:5174`).

- `ADMIN_REGION` (default `us-central1`): must match `VITE_FUNCTIONS_REGION` in `apps/admin`.
- `ADMIN_ORIGIN`: CORS origin for the callables (`https://admin.coldforge.work`).
- `ADMIN_ENFORCE_APP_CHECK` (default `false`): set `true` only after enabling App Check in the admin
  panel (`VITE_APPCHECK_SITE_KEY`, see `docs/deploy.md` → App Check).
- `ADMIN_ALLOW_ANY_ADMIN` (default `false`): `true` disables the email allowlist. Not recommended.
- `ADMIN_ALLOWED_EMAILS` — **a Cloud Secret Manager secret, not a `.env` value.** The repo is public and
  the value names the owner, so it must be deployed without being committed. firebase-functions v7
  supports exactly that with `defineSecret`: the value lives in Secret Manager, is bound to the admin
  callables at deploy time, and never touches git:

  ```sh
  bunx firebase-tools@15.32.1 functions:secrets:set ADMIN_ALLOWED_EMAILS --project coldforge-work
  # prompts for the value: you@gmail.com (comma-separate several)
  bunx firebase-tools@15.32.1 deploy --only functions --project coldforge-work
  ```

  An interactive deploy also prompts for it when missing; a non-interactive one fails and prints that
  command. Don't also put `ADMIN_ALLOWED_EMAILS=` in a `.env` file (a secret and an env var can't share a
  name). For the emulator, put `ADMIN_ALLOWED_EMAILS=…` in `apps/functions/.secret.local` (gitignored);
  without it the emulator treats the empty list as "any admin". (`.env.local` is never deployed but
  also never reaches production, so it can't carry a production value; a `defineString` would end up in
  a committed `.env.<project>` or be prompted for and then written there by the CLI.)

## Build and deploy

Firebase deploys this folder and Cloud Build runs `npm ci` here, where `workspace:*` can't resolve.
So `build.ts` bundles `src/index.ts` (and any `@cold-forge/*` workspace code it imports) into
`lib/index.js` with Bun, leaving only `firebase-functions` / `firebase-admin` external; the build
fails if anything else would be imported at runtime. `package.json` has an empty `gcp-build` so
Cloud Build doesn't try to rebuild, and `package-lock.json` pins the two runtime deps for `npm ci`.

```sh
bun run --cwd apps/functions build      # → lib/index.js
bunx firebase-tools@15.32.1 deploy --only functions --project coldforge-work
```

With the `predeploy` hook in `firebase.json` the build runs automatically on deploy.

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
  callables over HTTP (`integration/run.ts`), including `blocked/{uid}` on disable/delete, refused
  attempts in the audit log, the quota trigger and `onUserDeleted`. Needs Java 21. Behind an HTTP proxy,
  unset `HTTPS_PROXY`/`https_proxy` for this command: firebase-tools sends its emulator-to-emulator
  calls (Firestore trigger registration, the Auth onDelete multicast) through the proxy, ignoring
  `NO_PROXY`, and they fail with "request blocked".
- `src/quota.test.ts`: triggers, recount, `onUserDeleted` (block, then erase) and the delayed sweep with fakes.
