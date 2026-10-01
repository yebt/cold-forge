import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/** Production app origin. `.env.production` sets VITE_APP_URL to the same value (see docs/deploy.md). */
const DEFAULT_APP_URL = "https://app.coldforge.work";

const THEME = "#07090c";

/** Public URL of the app (OG tags, canonical). Must be https outside localhost. */
function appUrl(raw: string | undefined): string {
  const url = new URL(raw || DEFAULT_APP_URL);
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error(`VITE_APP_URL must be https: ${raw}`);
  return url.href.replace(/\/$/, "");
}

/**
 * Firebase Auth's `authDomain` (e.g. `cold-forge.firebaseapp.com` or a custom auth domain) hosts the
 * sign-in helper iframe/redirect handler, so it must be allowed in frame-src and connect-src.
 */
function firebaseAuthOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  const host = raw.replace(/^https:\/\//, "").replace(/\/$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)) throw new Error(`VITE_FIREBASE_AUTH_DOMAIN must be a hostname: ${raw}`);
  return `https://${host}`;
}

/** Firebase Auth (sign-in, token refresh) and Firestore REST/WebChannel endpoints. */
const FIREBASE_API_ORIGINS = [
  "https://identitytoolkit.googleapis.com",
  "https://securetoken.googleapis.com",
  "https://firestore.googleapis.com",
];

/**
 * Hosts App Check needs with the reCAPTCHA Enterprise provider (only when VITE_APPCHECK_SITE_KEY
 * is set): the token exchange, the reCAPTCHA script and its iframes.
 */
const APPCHECK_CONNECT = [
  "https://content-firebaseappcheck.googleapis.com",
  "https://recaptchaenterprise.googleapis.com",
  "https://www.google.com/recaptcha/",
];
const RECAPTCHA_SCRIPT = ["https://www.google.com/recaptcha/", "https://www.gstatic.com/recaptcha/"];
const RECAPTCHA_FRAME = ["https://www.google.com/recaptcha/", "https://recaptcha.google.com/recaptcha/"];

/** reCAPTCHA Enterprise site key (public), or null when App Check is off. */
function appCheckSiteKey(raw: string | undefined): string | null {
  if (!raw) return null;
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(raw)) throw new Error(`VITE_APPCHECK_SITE_KEY looks wrong: ${raw}`);
  return raw;
}

export interface CspInput {
  dev: boolean;
  authOrigin: string | null;
  /** App Check (reCAPTCHA Enterprise) is enabled: allow its hosts. */
  appCheck: boolean;
}

/**
 * The single source of the Content-Security-Policy. Used for the <meta> tag in index.html and,
 * with `frame-ancestors` added (meta tags can't carry it), for the `_headers` file on Cloudflare Pages.
 *
 * Hosts, checked against the Firebase JS SDK (@firebase/auth, @firebase/firestore):
 * - script-src https://apis.google.com: the popup/redirect flow loads gapi (`/js/api.js`), which
 *   pulls the rest of its loader from the same host.
 * - frame-src https://<authDomain>: the SDK embeds `<authDomain>/__/auth/iframe` to talk to the
 *   popup/redirect handler (`<authDomain>/__/auth/handler`, a separate window/navigation).
 *   https://apis.google.com stays in frame-src for gapi's own iframe helper.
 * - connect-src: Identity Toolkit (sign-in, project config), Secure Token (ID token refresh),
 *   Firestore, and the auth domain. No `*.googleapis.com` wildcard: it would let injected code
 *   exfiltrate to any Google API (e.g. a GCS bucket).
 * - App Check hosts only when VITE_APPCHECK_SITE_KEY is set.
 */
export function cspDirectives({ dev, authOrigin, appCheck }: CspInput): string[] {
  const auth = authOrigin ? [authOrigin] : [];
  // Dev only: Vite HMR websocket and the Firebase emulators on localhost.
  const devConnect = dev ? ["ws:", "wss:", "http://localhost:*", "http://127.0.0.1:*"] : [];
  const devFrame = dev ? ["http://localhost:*", "http://127.0.0.1:*"] : [];
  return [
    "default-src 'self'",
    ["script-src 'self'", "https://apis.google.com", ...(appCheck ? RECAPTCHA_SCRIPT : []), ...(dev ? ["'unsafe-inline'"] : [])].join(" "),
    dev ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
    // Google profile photos (signed-in users).
    "img-src 'self' blob: data: https://*.googleusercontent.com",
    "font-src 'self'",
    ["connect-src 'self'", ...FIREBASE_API_ORIGINS, ...auth, ...(appCheck ? APPCHECK_CONNECT : []), ...devConnect].join(" "),
    ["frame-src", ...auth, "https://apis.google.com", ...(appCheck ? RECAPTCHA_FRAME : []), ...devFrame].join(" "),
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ];
}

/**
 * Injects a strict Content-Security-Policy <meta> and fills the `_headers` file for Cloudflare Pages.
 * It is the main defence for local data and the Firebase session on the web: no inline or remote
 * scripts besides Google's auth helpers, no eval, and the page can only talk to itself and Firebase.
 * Origins come from the build env (`.env.production`): VITE_FIREBASE_AUTH_DOMAIN and (optional)
 * VITE_APPCHECK_SITE_KEY.
 *
 * The dev server needs two relaxations that never reach a build: React Fast Refresh injects an
 * inline module script, and Vite injects CSS through <style> tags and uses a websocket for HMR.
 */
function contentSecurityPolicy(input: Omit<CspInput, "dev">, publicUrl: string): Plugin {
  let dev = false;
  let outDir = "dist";
  return {
    name: "cold-forge-csp",
    configResolved(config) {
      dev = config.command === "serve";
      outDir = resolve(config.root, config.build.outDir);
    },
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const directives = cspDirectives({ ...input, dev });
        return html
          .replace("<!-- CSP -->", `<meta http-equiv="Content-Security-Policy" content="${directives.join("; ")}" />`)
          .replaceAll("%APP_URL%", publicUrl);
      },
    },
    writeBundle() {
      // public/_headers carries a __CSP__ placeholder so the header and the meta tag never drift apart.
      const file = join(outDir, "_headers");
      if (!existsSync(file)) return;
      const header = [...cspDirectives({ ...input, dev: false }), "frame-ancestors 'none'"].join("; ");
      writeFileSync(file, readFileSync(file, "utf8").replace("Content-Security-Policy: __CSP__", `Content-Security-Policy: ${header}`));
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  // A production build must never talk to the emulators or the mock backend (same guard as
  // apps/admin). The emulator branch is also gated on import.meta.env.DEV in the code.
  if (command === "build" && mode === "production") {
    if (env.VITE_USE_EMULATORS === "1") throw new Error("VITE_USE_EMULATORS=1 is not allowed in a production build.");
    if (env.VITE_FIREBASE_MOCK === "1") {
      throw new Error("VITE_FIREBASE_MOCK=1 is not allowed in a production build (use `vite build --mode mock` for UI tests).");
    }
  }
  const publicUrl = appUrl(env.VITE_APP_URL);
  return {
    plugins: [
      react(),
      contentSecurityPolicy(
        {
          authOrigin: firebaseAuthOrigin(env.VITE_FIREBASE_AUTH_DOMAIN),
          appCheck: appCheckSiteKey(env.VITE_APPCHECK_SITE_KEY) !== null,
        },
        publicUrl,
      ),
      VitePWA({
        registerType: "prompt",
        // src/pwa/runtime.ts registers the worker itself (skipped inside the Capacitor shells).
        injectRegister: false,
        manifestFilename: "manifest.webmanifest",
        includeAssets: ["favicon.ico", "favicon.svg", "apple-touch-icon.png"],
        manifest: {
          id: "/",
          name: "COLD FORGE",
          short_name: "COLD FORGE",
          description:
            "Track your Winter Arc: 92 days of cold showers, training, reading and early alarms. One-tap check-ins, streaks, ranks and story-ready share cards. Works offline.",
          lang: "en",
          dir: "ltr",
          start_url: "/",
          scope: "/",
          display: "standalone",
          orientation: "portrait",
          background_color: THEME,
          theme_color: THEME,
          categories: ["health", "fitness", "lifestyle", "productivity"],
          icons: [
            { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
            { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
            { src: "icons/monochrome-512.png", sizes: "512x512", type: "image/png", purpose: "monochrome" },
            { src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          ],
          screenshots: [
            {
              src: "screenshots/today.png",
              sizes: "1080x1920",
              type: "image/png",
              form_factor: "narrow",
              label: "Today: one tap per habit",
            },
            {
              src: "screenshots/progress.png",
              sizes: "1080x1920",
              type: "image/png",
              form_factor: "narrow",
              label: "Progress: streaks, rank and the 92-day heatmap",
            },
          ],
          shortcuts: [
            {
              name: "Check in today",
              short_name: "Check in",
              url: "/?source=shortcut",
              icons: [{ src: "icons/icon-192.png", sizes: "192x192", type: "image/png" }],
            },
          ],
        },
        workbox: {
          // App shell: the whole build is precached; the app is offline-first, so it is its own offline fallback.
          globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest,woff2}"],
          // The Firebase SDK chunk is loaded only on sign-in (src/sync/runtime.ts): precaching it
          // would download Firebase for every guest. Signed-in users get it cached on first use below.
          globIgnores: ["og.png", "screenshots/**", "_headers", "_redirects", "assets/firebaseBackend-*.js", "assets/firebaseAppCheck-*.js"],
          navigateFallback: "index.html",
          // Firebase auth handler paths (if ever served from this origin) must hit the network.
          navigateFallbackDenylist: [/^\/__\//],
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              // Hashed, immutable: cache-first keeps sign-in and sync working offline after first use.
              urlPattern: ({ url }) =>
                url.origin === self.location.origin && /\/assets\/firebase(Backend|AppCheck)-[^/]+\.js$/.test(url.pathname),
              handler: "CacheFirst",
              options: { cacheName: "firebase-sdk", expiration: { maxEntries: 4 } },
            },
            {
              // Never cache Google/Firebase traffic (auth tokens, Firestore streams, gapi scripts).
              urlPattern: ({ url }) =>
                /(^|\.)(googleapis\.com|gstatic\.com|google\.com|firebaseapp\.com|firebaseio\.com|web\.app)$/.test(url.hostname),
              handler: "NetworkOnly",
            },
          ],
        },
        devOptions: { enabled: false },
      }),
    ],
    // Relative asset paths so the bundle also loads from Capacitor's file-based webview.
    base: "./",
    build: {
      outDir: "dist",
      target: "es2022",
      rollupOptions: {
        output: {
          // App Check (only built when VITE_APPCHECK_SITE_KEY is set) gets a named lazy chunk, so the
          // service worker can skip precaching it like the Firebase chunk (guests never download it).
          manualChunks: (id: string) => (id.includes("@firebase/app-check") ? "firebaseAppCheck" : undefined),
        },
      },
    },
    server: { host: true },
  };
});
