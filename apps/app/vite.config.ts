import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/** Production app origin. `.env.production` sets VITE_APP_URL to the same value (see docs/deploy.md). */
const DEFAULT_APP_URL = "https://app.coldforge.work";

const THEME = "#070b12";

/** Optional extra API origin for connect-src (legacy self-hosted API). Must be plain http(s). */
function apiOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`VITE_API_URL must be http(s): ${raw}`);
  return url.origin;
}

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

/** Callable Cloud Functions origin (`https://<region>-<project>.cloudfunctions.net`). */
function functionsOrigin(region: string | undefined, projectId: string | undefined): string | null {
  if (!region || !projectId) return null;
  if (!/^[a-z0-9-]+$/.test(region) || !/^[a-z0-9-]+$/.test(projectId)) {
    throw new Error(`VITE_FUNCTIONS_REGION / VITE_FIREBASE_PROJECT_ID look wrong: ${region} ${projectId}`);
  }
  return `https://${region}-${projectId}.cloudfunctions.net`;
}

/** Google/Firebase endpoints used by Firebase Auth (Google sign-in) and Firestore. */
const GOOGLE_API_ORIGINS = [
  "https://*.googleapis.com",
  "https://securetoken.googleapis.com",
  "https://identitytoolkit.googleapis.com",
  "https://firestore.googleapis.com",
];

interface CspInput {
  dev: boolean;
  api: string | null;
  authOrigin: string | null;
  functions: string | null;
}

/**
 * The single source of the Content-Security-Policy. Used for the <meta> tag in index.html and,
 * with `frame-ancestors` added (meta tags can't carry it), for the `_headers` file on Cloudflare Pages.
 */
export function cspDirectives({ dev, api, authOrigin, functions }: CspInput): string[] {
  const auth = authOrigin ? [authOrigin] : [];
  const extra = [api, functions].filter((o): o is string => !!o);
  // Dev only: Vite HMR websocket and the Firebase emulators on localhost.
  const devConnect = dev ? ["ws:", "wss:", "http://localhost:*", "http://127.0.0.1:*"] : [];
  return [
    "default-src 'self'",
    ["script-src 'self'", "https://apis.google.com", "https://www.gstatic.com", ...(dev ? ["'unsafe-inline'"] : [])].join(" "),
    dev ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
    // Google profile photos (signed-in users).
    "img-src 'self' blob: data: https://*.googleusercontent.com",
    "font-src 'self'",
    ["connect-src 'self'", ...GOOGLE_API_ORIGINS, "https://www.gstatic.com", ...auth, ...extra, ...devConnect].join(" "),
    ["frame-src", ...auth, "https://apis.google.com"].join(" "),
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
 * Origins come from the build env (`.env.production`): VITE_FIREBASE_AUTH_DOMAIN,
 * VITE_FIREBASE_PROJECT_ID + VITE_FUNCTIONS_REGION, and the optional VITE_API_URL.
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const publicUrl = appUrl(env.VITE_APP_URL);
  return {
    plugins: [
      react(),
      contentSecurityPolicy(
        {
          api: apiOrigin(env.VITE_API_URL),
          authOrigin: firebaseAuthOrigin(env.VITE_FIREBASE_AUTH_DOMAIN),
          functions: functionsOrigin(env.VITE_FUNCTIONS_REGION, env.VITE_FIREBASE_PROJECT_ID),
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
          globIgnores: ["og.png", "screenshots/**", "_headers", "_redirects"],
          navigateFallback: "index.html",
          // Firebase auth handler paths (if ever served from this origin) must hit the network.
          navigateFallbackDenylist: [/^\/__\//],
          cleanupOutdatedCaches: true,
          runtimeCaching: [
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
    build: { outDir: "dist", target: "es2022" },
    server: { host: true },
  };
});
