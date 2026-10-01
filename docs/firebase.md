# Firebase: data model and responsibilities

Project `coldforge-work` · Firestore database `(default)` in `nam5` (US multi-region, cannot be changed) ·
Cloud Functions in `us-central1` (same geography as `nam5`).

Guest mode never loads Firebase. Only signed-in users (Google) touch Auth/Firestore.

## Firestore layout (all per user, owner-only)

| Path | Shape (from `@cold-forge/sync`) | Notes |
| --- | --- | --- |
| `users/{uid}` | `SyncProfile` + `createdAt` | `displayName`, `locale`, `currentArcId`, `updatedAt`. |
| `users/{uid}/arcs/{arcId}` | `SyncArc` | Doc id must equal `id`. |
| `users/{uid}/habits/{habitId}` | `SyncHabit` | Doc id must equal `id`; `arcId` must exist under the same user. |
| `users/{uid}/checkIns/{habitId}_{date}` | `SyncCheckIn` | Doc id must equal `${habitId}_${date}`. |

- Writes are last-write-wins on `updatedAt`, resolved by the client before writing. Rules reject
  `updatedAt` more than 5 minutes after `request.time` and enforce the same limits as `packages/sync/validate.ts`
  wherever the rules language can express them.
- Deletions are tombstones (`deletedAt`), except account deletion which removes everything.
- No other top-level collection is client-readable or client-writable.

## Server side (Cloud Functions, `apps/functions`)

- Admin callables, guarded by the `admin: true` custom claim: list/search users, disable/enable,
  delete (Auth user + all Firestore data), basic stats. Every action is written to `adminAuditLog/{id}`
  (functions-only collection).
- `onUserDeleted` auth trigger recursively deletes `users/{uid}` so data never outlives an account.
- `scripts/set-admin.ts`: grants/revokes the admin claim using local Application Default Credentials.

## Hosting (Cloudflare Pages)

| Project | Source | Domain |
| --- | --- | --- |
| landing | `apps/landing` (`dist`) | `coldforge.work` |
| app (PWA) | `apps/app` (`dist`) | `app.coldforge.work` |
| admin | `apps/admin` (`dist`) | `admin.coldforge.work` behind Cloudflare Access |
