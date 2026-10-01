# @cold-forge/functions

Cloud Functions (Node 22) for COLD FORGE: the admin callables and the `onUserDeleted` cleanup trigger.
Data model: [`docs/firebase.md`](../../docs/firebase.md).

| Export | Kind | What |
| --- | --- | --- |
| `adminListUsers` | callable (v2) | `{pageToken?, pageSize<=100, query?}` → users + per-user arc/habit/check-in counts |
| `adminGetUser` | callable | `{uid}` → account, `users/{uid}` profile, counts |
| `adminSetDisabled` | callable | `{uid, disabled, reason}`; disabling also revokes refresh tokens |
| `adminDeleteUser` | callable | `{uid, confirm: <their email>, reason?}` → lock, `recursiveDelete(users/{uid})`, delete account |
| `adminSetAdmin` | callable | `{uid, admin, reason?}`; revoking also revokes the target's sessions |
| `adminStats` | callable | totals, sign-ups 7/30 d, active 7 d (profile `updatedAt`), content totals |
| `adminListAuditLog` | callable | `{pageToken?, pageSize?}` → `adminAuditLog`, newest first |
| `onUserDeleted` | Auth trigger (v1 API) | `recursiveDelete(users/{uid})` whenever an account is deleted |

The wire contract is `src/api.ts` (type-only; `apps/admin` imports it).

## Security model

Every callable runs, in order:

1. **Token check** (`requireAdmin`, pure, no I/O): verified ID token with `admin === true`,
   `email_verified === true`, Google sign-in, and (optional) email in `ADMIN_ALLOWED_EMAILS`.
   Non-admins are rejected before any Firestore/Auth call.
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
6. **Audit**: every mutation (and failed mutation) writes `adminAuditLog/{autoId}`
   `{actorUid, actorEmail, action, targetUid, targetEmail, reason, outcome, at}`.

Errors are `HttpsError`s with `details.reason` for deliberate refusals; anything unexpected becomes
`internal` without the underlying message. Logs carry only `action`, `actorUid`, outcome/code: never
tokens, request bodies or emails of targets.

Instances are capped (`maxInstances: 3`, 256 MiB) to bound cost if someone hammers the endpoints.

## Params (`.env.<projectId>`)

See `.env.example`. `.env.coldforge-work` is committed (nothing secret). `.env.local` is for the
emulator only (`ADMIN_ORIGIN=http://localhost:5174`).

- `ADMIN_REGION` (default `us-central1`): must match `VITE_FUNCTIONS_REGION` in `apps/admin`.
- `ADMIN_ORIGIN`: CORS origin for the callables (`https://admin.coldforge.work`).
- `ADMIN_ENFORCE_APP_CHECK` (default `false`): set `true` only after adding App Check to the admin
  panel (and adding the App Check origins to its CSP).
- `ADMIN_ALLOWED_EMAILS`: optional second lock besides the claim.

## Build and deploy

Firebase deploys this folder and Cloud Build runs `npm ci` here, where `workspace:*` can't resolve.
So `build.ts` bundles `src/index.ts` (and any `@cold-forge/*` workspace code it imports) into
`lib/index.js` with Bun, leaving only `firebase-functions` / `firebase-admin` external; the build
fails if anything else would be imported at runtime. `package.json` has an empty `gcp-build` so
Cloud Build doesn't try to rebuild, and `package-lock.json` pins the two runtime deps for `npm ci`.

```sh
bun run --cwd apps/functions build      # → lib/index.js
bunx firebase-tools@15 deploy --only functions --project coldforge-work
```

With the `predeploy` hook in `firebase.json` the build runs automatically on deploy.

After changing dependencies, refresh the npm lockfile outside the workspace:

```sh
d=$(mktemp -d) && cp apps/functions/package.json "$d" && (cd "$d" && npm install --package-lock-only --ignore-scripts) && cp "$d/package-lock.json" apps/functions/
```

## Tests

- `bun test src`: validation, guard, rate limit, adapters and every use case against in-memory
  Auth/Firestore fakes (`src/testing/fakes.ts`).
- `bun run test:emulators`: builds, starts the Auth/Firestore/Functions emulators and calls the real
  callables over HTTP (`integration/run.ts`). Needs Java 21.
