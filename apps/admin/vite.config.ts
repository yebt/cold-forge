import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

/**
 * COLD FORGE admin panel. Static build for Cloudflare Pages (admin.<domain>, behind Cloudflare
 * Access). The only network peers are Firebase Auth (Google popup) and the admin callables.
 */

const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const PROJECT_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const REGION_RE = /^[a-z]+-[a-z]+[0-9]$/;

interface CspInput {
  authDomain: string;
  projectId: string;
  region: string;
  emulators: boolean;
  /** App Check (reCAPTCHA Enterprise) enabled via VITE_APPCHECK_SITE_KEY: allow its hosts. */
  appCheck: boolean;
}

function readEnv(env: Record<string, string>, strict: boolean): CspInput {
  const authDomain = env.VITE_FIREBASE_AUTH_DOMAIN ?? "";
  const projectId = env.VITE_FIREBASE_PROJECT_ID ?? "";
  const region = env.VITE_FUNCTIONS_REGION || "us-central1";
  const emulators = env.VITE_USE_EMULATORS === "1";
  const appCheckKey = env.VITE_APPCHECK_SITE_KEY ?? "";
  if (appCheckKey && !/^[A-Za-z0-9_-]{20,100}$/.test(appCheckKey)) throw new Error(`VITE_APPCHECK_SITE_KEY looks wrong: ${appCheckKey}`);
  if (strict) {
    const missing = [
      "VITE_FIREBASE_API_KEY",
      "VITE_FIREBASE_AUTH_DOMAIN",
      "VITE_FIREBASE_PROJECT_ID",
      "VITE_FIREBASE_APP_ID",
    ].filter((k) => !env[k]);
    if (missing.length) throw new Error(`Missing env for the admin build: ${missing.join(", ")}`);
    if (!HOST_RE.test(authDomain)) throw new Error(`VITE_FIREBASE_AUTH_DOMAIN must be a bare host: ${authDomain}`);
    if (!PROJECT_RE.test(projectId)) throw new Error(`VITE_FIREBASE_PROJECT_ID looks wrong: ${projectId}`);
    if (!REGION_RE.test(region)) throw new Error(`VITE_FUNCTIONS_REGION looks wrong: ${region}`);
  }
  return { authDomain, projectId, region, emulators, appCheck: appCheckKey !== "" };
}

/**
 * Strict Content-Security-Policy <meta>, built from the Firebase config so it names exact hosts:
 *
 * - script-src https://apis.google.com: the Auth SDK loads gapi (`/js/api.js`) for the popup flow.
 * - frame-src https://<authDomain>: the SDK embeds `<authDomain>/__/auth/iframe` to talk to the popup
 *   (the popup itself is a separate window at `<authDomain>/__/auth/handler`, not governed by this page).
 * - connect-src: Identity Toolkit (sign-in, project config), Secure Token (ID token refresh) and the
 *   callables at `https://<region>-<project>.cloudfunctions.net`. Narrower than `*.googleapis.com`
 *   on purpose: a wildcard there would let injected code exfiltrate to any Google API (e.g. a GCS bucket).
 * - img-src lh3.googleusercontent.com: Google profile photos.
 * - Only with App Check (VITE_APPCHECK_SITE_KEY): reCAPTCHA Enterprise script/iframes
 *   (www.google.com/recaptcha/, www.gstatic.com/recaptcha/, recaptcha.google.com/recaptcha/) and the
 *   token exchange (content-firebaseappcheck.googleapis.com, recaptchaenterprise.googleapis.com).
 *
 * The dev server needs inline scripts/styles (React Fast Refresh, Vite CSS) and a websocket for HMR;
 * those relaxations never reach a build. `frame-ancestors` can't be set from <meta>: see public/_headers.
 */
function contentSecurityPolicy(input: CspInput): Plugin {
  let dev = false;
  return {
    name: "cold-forge-admin-csp",
    configResolved(config) {
      dev = config.command === "serve";
    },
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const functionsOrigin = input.projectId ? `https://${input.region}-${input.projectId}.cloudfunctions.net` : "";
        const authFrame = input.authDomain ? `https://${input.authDomain}` : "";
        const emu = input.emulators ? ["http://127.0.0.1:9099", "http://127.0.0.1:5001", "http://localhost:9099", "http://localhost:5001"] : [];
        const join = (...parts: string[]) => parts.filter(Boolean).join(" ");
        const ac = input.appCheck;
        const recaptchaScript = ac ? "https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/" : "";
        const recaptchaFrame = ac ? "https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/" : "";
        const appCheckConnect = ac
          ? "https://content-firebaseappcheck.googleapis.com https://recaptchaenterprise.googleapis.com https://www.google.com/recaptcha/"
          : "";
        const directives = [
          "default-src 'self'",
          join("script-src 'self' https://apis.google.com", recaptchaScript, dev ? "'unsafe-inline'" : ""),
          join("style-src 'self'", dev ? "'unsafe-inline'" : ""),
          "img-src 'self' data: https://lh3.googleusercontent.com",
          "font-src 'self'",
          join(
            "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
            functionsOrigin,
            appCheckConnect,
            ...emu,
            dev ? "ws: wss:" : "",
          ),
          join("frame-src", authFrame || "'none'", recaptchaFrame, ...emu.filter((e) => e.endsWith(":9099"))),
          "worker-src 'none'",
          "manifest-src 'self'",
          "object-src 'none'",
          "base-uri 'none'",
          "form-action 'none'",
        ];
        return html.replace(
          "<!-- CSP -->",
          `<meta http-equiv="Content-Security-Policy" content="${directives.join("; ")}" />`,
        );
      },
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const building = command === "build";
  if (building && mode === "production" && env.VITE_USE_EMULATORS === "1") {
    throw new Error("VITE_USE_EMULATORS=1 is not allowed in a production build.");
  }
  // The mock layer is compiled out of builds regardless (it is gated on import.meta.env.DEV);
  // refusing the flag makes the intent explicit.
  if (building && env.VITE_ADMIN_MOCK === "1") {
    throw new Error("VITE_ADMIN_MOCK=1 is dev-only; unset it for builds.");
  }
  return {
    plugins: [react(), contentSecurityPolicy(readEnv(env, building))],
    build: { outDir: "dist", target: "es2022", sourcemap: false },
    server: { port: 5174, strictPort: true },
    preview: { port: 4174, strictPort: true },
  };
});
