# Firebase: data model and responsibilities

Project `coldforge-work` · Firestore database `(default)` in `nam5` (US multi-region, cannot be changed) ·
Cloud Functions in `us-central1` (same geography as `nam5`).

Guest mode never loads Firebase. Only signed-in users (Google) touch Auth/Firestore.
Rules: `firebase/firestore.rules`, tested in `firebase/rules.test.ts` (emulator) and end to end in
`apps/app/src/firebase/emulator.test.ts`.

## Firestore layout (all per user, owner-only)

| Path | Shape (from `@cold-forge/sync`) | Notes |
| --- | --- | --- |
| `users/{uid}` | `SyncProfile` + `createdAt` | `displayName`, `locale`, `currentArcId` (null or an existing arc of the user), `updatedAt`. |
| `users/{uid}/arcs/{arcId}` | `SyncArc` | Doc id must equal `id`. Starts on/after 2024-01-01, at most 366 days. |
| `users/{uid}/habits/{habitId}` | `SyncHabit` | Doc id must equal `id`; `arcId` must exist under the same user and not be tombstoned (unless the habit itself is). |
| `users/{uid}/checkIns/{habitId}_{date}` | `SyncCheckIn` | Doc id must equal `${habitId}_${date}`; the habit must exist and not be tombstoned; `date` within [now − 400 d, now + 2 d]. |
| `quota/{uid}` | `{arcs, habits, checkIns, checkInsCountedAt, updatedAt}` | Functions only. Per-user document counts. |
| `blocked/{uid}` | `{reason: "disabled" \| "quota" \| "deleted", at, sweepAfter?}` | Functions only. While it exists the rules refuse every read and write of that uid. |
| `adminAuditLog/{id}`, `adminRateLimits/{key}` | see `apps/functions` | Functions only. |

- Writes are last-write-wins on `updatedAt`, resolved by the client before writing. Rules reject
  `updatedAt` more than 5 minutes after `request.time` and enforce the same limits as `packages/sync/validate.ts`
  wherever the rules language can express them. String lengths are UTF-16 code units on both sides
  (`string.size()` in the rules, `.length` in JS): name 60, why 280, displayName 40, emoji 16.
- **Bounded key space** (`WRITE_BOUNDS` in `packages/sync`): every timestamp ≥ 2024-01-01T00:00:00.000Z,
  `createdAt ≤ updatedAt`, `createdAt` immutable once written, arcs from 2024-01-01 spanning ≤ 366 days,
  check-in dates within [now − 400 days, now + 2 days]. With ≤ 500 habits that bounds an account to
  roughly 200k check-in documents even before the quota job kicks in.
- **Old check-ins stay local.** Check-ins older than 400 days (e.g. from an imported export) are kept
  on the device but never pushed: the outgoing pre-validator holds them back (and the arc/habits they
  hang off, if those are older than 2024). Data read back from the server is *not* subject to the write
  window, so a check-in written a year ago still syncs down to a new device.
- **No client deletes.** Deletions are tombstones (`deletedAt`); the rules have `allow delete: if false`
  for the profile, arcs, habits and check-ins. Account deletion is Firebase Auth's `user.delete()`
  (after a Google re-authentication); `onUserDeleted` then removes the data server-side.
- **Quotas** (`QUOTAS` in `packages/sync/src/quotas.ts`, the single source): 50 arcs, 500 habits,
  50 000 check-ins per user, tombstones included. Over a quota → `blocked/{uid}` {reason: "quota"};
  the app shows "Sync is disabled for this account — contact support" and stops retrying.
- **Cost of the `blocked` check:** `isOwner()` does one `exists(blocked/{uid})` per request (read *and*
  write), billed as one document read per request — per get, per query, per listener attach and per
  batched write — not per document returned. A normal sync (3 queries + 1 profile get, 1–2 batches)
  adds ~5–6 reads; at nam5 prices ($0.06 per 100k reads) 10k daily users syncing 20×/day cost
  ≈ $0.60–0.70/day extra. Reads are gated too because a disabled/deleted user must also stop
  *seeing* the data immediately, and it lets the app tell "blocked" (refused read) apart from
  "a rule rejected this write".
- Rules lookups per batched write: blocked (1) + profile `currentArcId` (1) + up to 15 distinct parents
  (`MAX_PUSH_PARENTS`) stay under the limit of 20 access calls (`getAfter`/`existsAfter` on the same
  parent count once).

## Server side (Cloud Functions, `apps/functions`)

- Admin callables: list/search users, disable/enable, delete (Auth user + all Firestore data), basic
  stats, `adminWhoAmI`. **The allowlist is the admin role:** a caller is an admin iff the token has a
  verified email, a Google sign-in, and that email (trimmed, lower-cased) is in the
  `ADMIN_ALLOWED_EMAILS` Secret Manager secret; every call also re-reads the caller's Auth record
  (enabled, not revoked, same verified email, still listed). No custom claims; empty secret → every
  admin call is refused. Admins are managed with `firebase functions:secrets:set ADMIN_ALLOWED_EMAILS`
  + a functions redeploy (secrets are read at instance start). Allowlisted accounts can't be
  disabled or deleted from the panel, and nobody can act on their own account. Every mutation, every refused
  mutation attempt (outcome `refused` + reason code) and every single-account view (`user.view`) is
  written to `adminAuditLog/{id}`. List pages are not audited.
- Disabling a user writes `blocked/{uid}` {reason: "disabled"} (Firestore access ends at once, not when
  the 1-hour ID token expires); enabling removes it unless the reason is `quota` or `deleted`.
- `onUserDeleted` (Auth trigger) writes `blocked/{uid}` {reason: "deleted"} first, then
  `recursiveDelete(users/{uid})`. The block stays (a uid is never reused); `sweepDeletedAccounts`
  (hourly) erases `users/{uid}` once more an hour later, in case a write was in flight.
- `quotaOnArcCreated` / `quotaOnHabitCreated` (Firestore `onDocumentCreated`) keep `quota/{uid}` counts
  with `FieldValue.increment`; `quotaRecountCheckIns` (daily 03:17 UTC) recounts check-ins with
  `count()` for accounts active in the last 2 days plus the least-recently-counted ones (everyone at
  least weekly), blocks anyone over `QUOTAS.checkIns` and logs accounts that gained > 5000 check-in
  documents since the previous count.
- Deploys: `.github/workflows/firebase-deploy.yml` (keyless, Workload Identity Federation) on every
  push to `main` touching rules or functions; see `docs/deploy.md`.

## Hosting (Cloudflare Pages)

| Project | Source | Domain |
| --- | --- | --- |
| landing | `apps/landing` (`dist`) | `coldforge.work` |
| app (PWA) | `apps/app` (`dist`) | `app.coldforge.work` |
| admin | `apps/admin` (`dist`) | `admin.coldforge.work` (Cloudflare Access recommended, optional) |
