# @cold-forge/admin

Internal admin panel (React 19 + Vite), static on Cloudflare Pages at `admin.coldforge.work`
(Cloudflare Access in front is recommended, optional). Google sign-in, then the panel calls
`adminWhoAmI`: only an account the server accepts as admin (verified Google email listed in the
`ADMIN_ALLOWED_EMAILS` secret, live account check) gets in; anyone else is signed out
("Not authorized"). The browser evaluates no claim or allowlist itself. All data comes from the admin
callables in `apps/functions`. The panel never reads Firestore directly. The "Admin" badge on a user
comes from the server (`isAdmin`: email in the allowlist); such accounts can't be disabled or deleted
here. Admins are added/removed only through the secret (see `apps/functions/README.md`).

```sh
bun run dev:mock       # fixtures only, no Firebase (dev only, compiled out of builds)
bun run dev:emulators  # against local emulators (auth :9099, functions :5001)
bun run build          # vite build + check that no mock code is in dist/
```

- Config: `VITE_FIREBASE_*` + `VITE_FUNCTIONS_REGION` (`.env.production`, see `.env.example`).
  The build fails if they're missing or malformed, and refuses `VITE_USE_EMULATORS` / `VITE_ADMIN_MOCK`.
- Copy: `src/copy.ts`. Data layer: `src/backend/` (`firebase.ts` real, `mock.ts` dev fixtures).
- Session: tab-scoped (`browserSessionPersistence`), auto sign-out after 30 idle minutes, admin
  status re-checked with `adminWhoAmI` on every token refresh. Delete may ask to re-authenticate.
- Emulators: sign in as `admin@example.com` in the fake Google picker (the emulator allowlist,
  `apps/functions/.env.demo-coldforge`).

## Content-Security-Policy

Generated into `index.html` at build time from the Firebase config (`vite.config.ts`):

| Directive | Value | Why |
| --- | --- | --- |
| `script-src` | `'self' https://apis.google.com` | Auth SDK loads `apis.google.com/js/api.js` (gapi) for the popup flow |
| `frame-src` | `https://<authDomain>` | hidden `<authDomain>/__/auth/iframe` relays the popup result |
| `connect-src` | `'self'` Identity Toolkit, Secure Token, `https://<region>-<project>.cloudfunctions.net` | sign-in, token refresh, callables |
| `img-src` | `'self' data: https://lh3.googleusercontent.com` | Google avatars |
| `object-src` / `base-uri` / `form-action` / `worker-src` | `'none'` | |

With `VITE_APPCHECK_SITE_KEY` set (App Check on, off by default), the build also allows the
reCAPTCHA Enterprise script/iframes (`www.google.com/recaptcha/`, `www.gstatic.com/recaptcha/`,
`recaptcha.google.com/recaptcha/`) and the token exchange (`content-firebaseappcheck.googleapis.com`,
`recaptchaenterprise.googleapis.com`), and initializes App Check before any callable; only then set
`ADMIN_ENFORCE_APP_CHECK=true` in `apps/functions`. Without the key none of that is in the bundle or CSP.

`connect-src` deliberately names exact hosts instead of `*.googleapis.com` / `*.run.app`, so
injected code can't exfiltrate to arbitrary Google endpoints. The popup itself is a separate window
at `<authDomain>/__/auth/handler` (not governed by this page's CSP). `public/_headers` adds
`frame-ancestors 'none'`, `X-Frame-Options: DENY`, nosniff, `Referrer-Policy: no-referrer`,
a minimal `Permissions-Policy`, HSTS, `COOP: same-origin-allow-popups` (keeps the popup working)
and `X-Robots-Tag: noindex`.
