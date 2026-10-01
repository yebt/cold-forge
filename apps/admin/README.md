# @cold-forge/admin

Internal admin panel (React 19 + Vite), static on Cloudflare Pages at `admin.coldforge.work`,
behind Cloudflare Access. Google sign-in, then the ID token must carry `admin: true`; otherwise the
user is signed out ("Not authorized"). All data comes from the admin callables in `apps/functions`.
The panel never reads Firestore directly.

```sh
bun run dev:mock       # fixtures only, no Firebase (dev only, compiled out of builds)
bun run dev:emulators  # against local emulators (auth :9099, functions :5001)
bun run build          # vite build + check that no mock code is in dist/
```

- Config: `VITE_FIREBASE_*` + `VITE_FUNCTIONS_REGION` (`.env.production`, see `.env.example`).
  The build fails if they're missing or malformed, and refuses `VITE_USE_EMULATORS` / `VITE_ADMIN_MOCK`.
- Copy: `src/copy.ts`. Data layer: `src/backend/` (`firebase.ts` real, `mock.ts` dev fixtures).
- Session: tab-scoped (`browserSessionPersistence`), auto sign-out after 30 idle minutes, claim
  re-checked on every token refresh. Delete / admin changes may ask to re-authenticate.

## Content-Security-Policy

Generated into `index.html` at build time from the Firebase config (`vite.config.ts`):

| Directive | Value | Why |
| --- | --- | --- |
| `script-src` | `'self' https://apis.google.com` | Auth SDK loads `apis.google.com/js/api.js` (gapi) for the popup flow |
| `frame-src` | `https://<authDomain>` | hidden `<authDomain>/__/auth/iframe` relays the popup result |
| `connect-src` | `'self'` Identity Toolkit, Secure Token, `https://<region>-<project>.cloudfunctions.net` | sign-in, token refresh, callables |
| `img-src` | `'self' data: https://lh3.googleusercontent.com` | Google avatars |
| `object-src` / `base-uri` / `form-action` / `worker-src` | `'none'` | |

`connect-src` deliberately names exact hosts instead of `*.googleapis.com` / `*.run.app`, so
injected code can't exfiltrate to arbitrary Google endpoints. The popup itself is a separate window
at `<authDomain>/__/auth/handler` (not governed by this page's CSP). `public/_headers` adds
`frame-ancestors 'none'`, `X-Frame-Options: DENY`, nosniff, `Referrer-Policy: no-referrer`,
a minimal `Permissions-Policy`, HSTS, `COOP: same-origin-allow-popups` (keeps the popup working)
and `X-Robots-Tag: noindex`.
