# Deploy: Cloudflare Pages, Firebase and the Android APK

COLD FORGE ships as a **PWA first** (installable web app at `app.coldforge.work`), a static
landing (`coldforge.work`), and a downloadable **Android APK** built by GitHub Actions.

| What | Source | Build output | Domain |
| --- | --- | --- | --- |
| Landing | `apps/landing` (Astro) | `apps/landing/dist` | `https://coldforge.work` |
| App (PWA) | `apps/app` (Vite + React) | `apps/app/dist` | `https://app.coldforge.work` |
| Admin | `apps/admin` | `apps/admin/dist` | `https://admin.coldforge.work` (behind Cloudflare Access) |
| Android APK | `apps/app` + `apps/app/android` (Capacitor) | GitHub Release asset | `https://github.com/yebt/cold-forge/releases/latest/download/cold-forge.apk` |

Firebase project: `coldforge-work` (auth domain `coldforge-work.firebaseapp.com`).

---

## 1. Cloudflare Pages

Create **one Pages project per app** from the same GitHub repo
(Workers & Pages → Create → Pages → Connect to Git → `yebt/cold-forge`, production branch `main`).

### App (PWA) — project `cold-forge-app`

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Root directory | `/` (repo root — it is a Bun workspace) |
| Build command | `bun install --frozen-lockfile && bun run --filter @cold-forge/app build` |
| Build output directory | `apps/app/dist` |
| Environment variables | `BUN_VERSION=1.3.14`, `NODE_VERSION=22` |

The Firebase web config and URLs come from the committed `apps/app/.env.production`
(`VITE_FIREBASE_*`, `VITE_FUNCTIONS_REGION`, `VITE_APP_URL`, `VITE_SITE_URL`). They are public by design.
Only set them as Pages variables to override a value — and never set one to an empty string
(Vite would use the empty value).

What the build produces for Cloudflare:

- `_headers` (from `apps/app/public/_headers`): security headers and cache rules. The
  `Content-Security-Policy` line is filled in at build time by `vite.config.ts` from the same function
  that writes the `<meta>` CSP in `index.html`, plus `frame-ancestors 'none'`, so the two never drift.
  Firebase origins in it are derived from `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID` and
  `VITE_FUNCTIONS_REGION`.
- Cache: `/assets/*` immutable for a year; `/`, `/index.html`, `/sw.js`, `/workbox-*.js` and
  `/manifest.webmanifest` are `no-cache` so a new deploy reaches users (the app shows
  "New version available — Reload").
- No `_redirects`: the app has no client-side routes (only `#…` hashes), and the service worker serves
  the app shell for any navigation once installed.

### Landing — project `cold-forge-landing`

| Setting | Value |
| --- | --- |
| Root directory | `/` |
| Build command | `bun install --frozen-lockfile && bun run --filter @cold-forge/landing build` |
| Build output directory | `apps/landing/dist` |
| Environment variables | `BUN_VERSION=1.3.14`, `NODE_VERSION=22`, `SITE_URL=https://coldforge.work`, `APP_URL=https://app.coldforge.work` |

Optional: `APK_URL` (defaults to the GitHub "latest release" download link above).
`apps/landing/public/_headers` sets HSTS, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, etc.

### Admin — project `cold-forge-admin`

Same pattern (`bun run --filter @cold-forge/admin build`, output `apps/admin/dist`); see the admin app's
own docs. Put `admin.coldforge.work` behind **Cloudflare Zero Trust → Access** (application with an
allow-list policy for the owner's email).

### Custom domains and DNS

1. Add `coldforge.work` to Cloudflare (Websites → Add a site) and switch the registrar's nameservers to
   the two Cloudflare nameservers shown. The apex domain on Pages requires Cloudflare DNS.
2. In each Pages project → Custom domains → Set up a domain:
   - landing → `coldforge.work` (optionally also `www.coldforge.work`, then a Redirect Rule
     `www.coldforge.work/*` → `https://coldforge.work/${1}`, 301)
   - app → `app.coldforge.work`
   - admin → `admin.coldforge.work`

   Cloudflare creates the proxied CNAME records (`app` → `cold-forge-app.pages.dev`, …) itself.
3. SSL/TLS → Edge Certificates: *Always Use HTTPS* on. HSTS is sent by `_headers`
   (`max-age=31536000; includeSubDomains`); only add `preload` once every subdomain is HTTPS-only for good.

---

## 2. Firebase

1. **Authentication → Settings → Authorized domains**: add `coldforge.work`, `app.coldforge.work`,
   `admin.coldforge.work` (`localhost` and `coldforge-work.firebaseapp.com` are there by default).
   Preview deploys (`*.pages.dev`) are intentionally *not* authorized: Google sign-in only works on
   the real domains.
2. **Authentication → Sign-in method**: enable Google.
3. **Restrict the browser API key** — Google Cloud Console → project `coldforge-work` → APIs & Services →
   Credentials → the "Browser key (auto created by Firebase)" (the one in `VITE_FIREBASE_API_KEY`):
   - Application restrictions → **Websites**:
     - `https://coldforge.work/*`
     - `https://app.coldforge.work/*`
     - `https://admin.coldforge.work/*`
     - `https://coldforge-work.firebaseapp.com/*` (the Google sign-in handler page runs there)
     - `http://localhost:*/*` and `http://127.0.0.1:*/*` (development)
     - `https://localhost/*` (the Android app: Capacitor's WebView origin is `https://localhost`)
   - API restrictions → **Restrict key**: Identity Toolkit API, Token Service API, Cloud Firestore API
     (add Firebase Installations API only if a Firebase product later needs it; there is no Analytics).
4. **Android app (for native Google sign-in in the APK)**: Project settings → Add app → Android,
   package `work.coldforge.app`. Add the **SHA-1 and SHA-256** of the release keystore (section 3) and of your
   local debug keystore. Download `google-services.json` and store it as the
   `GOOGLE_SERVICES_JSON_BASE64` secret (`base64 -w0 google-services.json`). Without it the APK still
   works in guest mode, but "Sign in with Google" fails.

### Sign-in notes

- The PWA uses `signInWithPopup` (falls back to `signInWithRedirect`). The auth helper is served from
  `coldforge-work.firebaseapp.com`, which the CSP allows (`frame-src`, `connect-src`).
- Browsers that partition third-party storage (Safari, Chrome with 3P cookies off) can break the
  *redirect* flow across domains. If that shows up, proxy `https://app.coldforge.work/__/auth/*` to
  `https://coldforge-work.firebaseapp.com/__/auth/*` (Cloudflare Worker or a Pages Function) and set
  `VITE_FIREBASE_AUTH_DOMAIN=app.coldforge.work`. The service worker already lets `/__/*` navigations
  through to the network.

---

## 3. Android APK (GitHub Actions)

Workflow: `.github/workflows/android.yml`.

- Push a tag `vX.Y.Z` → builds the web bundle, `cap sync android`, `./gradlew assembleRelease` signed
  with your keystore, renames it to `cold-forge.apk`, writes `cold-forge.apk.sha256`, uploads both as an
  artifact and attaches them to the GitHub Release for the tag (marked *latest*, which is what the
  landing's download button points to). `versionName` = `X.Y.Z`, `versionCode` = `X*1000000 + Y*1000 + Z`.
- Actions → *Android APK* → *Run workflow* → same build, artifact only.
- No keystore secrets → it builds a **debug** APK with a loud warning; on a tag the release is marked
  *pre-release* and not *latest*, so the public download link never points at a debug build.

The native project `apps/app/android` is committed (generated with `bunx cap add android`). Launcher
icons, adaptive icon (with the Android 13 monochrome layer) and splash screens are generated from
`apps/app/assets` (see section 5).

### Create the release keystore (once)

```sh
keytool -genkeypair -v \
  -keystore cold-forge-release.jks -storetype PKCS12 \
  -alias coldforge -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=COLD FORGE, O=COLD FORGE"
# PKCS12 uses the store password for the key too: ANDROID_KEY_PASSWORD = ANDROID_KEYSTORE_PASSWORD.

keytool -list -v -keystore cold-forge-release.jks -alias coldforge   # SHA-1 / SHA-256 for Firebase
```

**Back the `.jks` and its password up somewhere safe (password manager).** If it is lost, existing
installs can never be updated: users would have to uninstall (losing local data) and reinstall.
Never commit it.

### Add the secrets

Settings → Secrets and variables → Actions → *New repository secret*, or with the GitHub CLI:

```sh
base64 -w0 cold-forge-release.jks | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set ANDROID_KEYSTORE_PASSWORD     # paste the store password
gh secret set ANDROID_KEY_ALIAS --body coldforge
gh secret set ANDROID_KEY_PASSWORD          # same as the store password for PKCS12
base64 -w0 google-services.json | gh secret set GOOGLE_SERVICES_JSON_BASE64
```

Optional repository **variables** (not secrets) override `apps/app/.env.production` for the APK build:
`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
`VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`,
`VITE_FUNCTIONS_REGION`, `VITE_APP_URL`, `VITE_SITE_URL`. Empty ones are ignored.

### Release

```sh
git tag v0.1.0 && git push origin v0.1.0
```

Users verify a download with `sha256sum -c cold-forge.apk.sha256`. Installing needs
"Install unknown apps" allowed for the browser; the landing and FAQ explain that the PWA is the same app.

### All third-party actions are pinned to commit SHAs

`actions/checkout` v7.0.1, `oven-sh/setup-bun` v2.2.0, `actions/setup-java` v6.0.1,
`android-actions/setup-android` v4.0.4, `gradle/actions/setup-gradle` v6.4.0,
`actions/upload-artifact` v7.0.1, `softprops/action-gh-release` v3.0.3. To update one, resolve the new
tag to its commit (`git ls-remote https://github.com/<owner>/<repo>.git 'refs/tags/vX.Y.Z^{}'`, or the
plain tag ref for lightweight tags) and replace the SHA and the version comment.
`ci.yml` runs install (`--frozen-lockfile`), typecheck, tests and both builds on every push/PR.

---

## 4. Where the domain lives

| Place | Value | Override |
| --- | --- | --- |
| `apps/app/.env.production` | `VITE_APP_URL`, `VITE_SITE_URL`, Firebase auth domain | Pages / Actions variables |
| `apps/app/vite.config.ts` | `DEFAULT_APP_URL = https://app.coldforge.work` (fallback for `%APP_URL%` in `index.html`: canonical, `og:url`, `og:image`) | `VITE_APP_URL` |
| `apps/app/public/_headers` | comment only | — |
| `apps/landing/astro.config.mjs` | `site` (`SITE_URL`), `APP_URL`, `APK_URL` defaults | `SITE_URL`, `APP_URL`, `APK_URL` |
| `apps/landing/src/layouts/Base.astro`, `src/pages/index.astro` | fallback when `Astro.site` is unset | `SITE_URL` |
| `apps/landing/public/_headers` | comment only | — |
| `docs/firebase.md`, this file | documentation | — |

`brand/generate.ts` does not bake the domain into any image.

---

## 5. Brand assets

Sources: `brand/logo.svg` (tile + mark), `brand/logo-mono.svg`. Everything else is generated:

```sh
bun brand/generate.ts                                 # wordmark, favicons, PWA icons, OG images, apps/app/assets/*
(cd apps/app && bun run assets:android)               # @capacitor/assets → android/res, then the monochrome layer
# Manifest screenshots (needs a Chromium; uses the real build):
bun run --filter @cold-forge/app build && (cd apps/app && bunx vite preview --port 4173 --strictPort) &
CHROMIUM_PATH=/path/to/chrome bun brand/screenshots.ts
```

---

## 6. Platform limits worth knowing

- **Web/PWA reminders**: browsers can't schedule local notifications while the app is closed, so
  reminders only fire in the Android APK (or while the PWA is open). iOS web apps would need server push.
- **iOS**: no install prompt — the app shows "Share → Add to Home Screen" steps in Safari. Data saved by
  a home-screen web app is kept; in a plain Safari tab, WebKit may clear it after weeks without visits,
  so iPhone users should install it (or sign in to sync).
- **Android APK vs PWA**: same bundle. The APK never registers the service worker (Capacitor serves the
  files) and updates only when the user installs a newer APK.
