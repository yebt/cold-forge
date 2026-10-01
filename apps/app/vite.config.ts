import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

const DEFAULT_API_URL = "http://localhost:3001";

/** The API origin for connect-src. Anything that isn't a plain http(s) origin fails the build. */
function apiOrigin(raw: string | undefined): string {
  const url = new URL(raw || DEFAULT_API_URL);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`VITE_API_URL must be http(s): ${raw}`);
  return url.origin;
}

/**
 * Injects a strict Content-Security-Policy <meta>. It is the main defence for the session token
 * on the web (Preferences = localStorage there): no inline or remote scripts, no eval, and the
 * page can only talk to itself and the API.
 *
 * The dev server needs two relaxations that never reach a build: React Fast Refresh injects an
 * inline module script, and Vite injects CSS through <style> tags and uses a websocket for HMR.
 * (`frame-ancestors` can't be set from a meta tag; the host must send it as a header.)
 */
function contentSecurityPolicy(api: string): Plugin {
  let dev = false;
  return {
    name: "cold-forge-csp",
    configResolved(config) {
      dev = config.command === "serve";
    },
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const directives = [
          "default-src 'self'",
          dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
          dev ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
          "img-src 'self' blob: data:",
          "font-src 'self'",
          `connect-src 'self' ${api}${dev ? " ws: wss:" : ""}`,
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react(), contentSecurityPolicy(apiOrigin(env.VITE_API_URL))],
    // Relative asset paths so the bundle also loads from Capacitor's file-based webview.
    base: "./",
    build: { outDir: "dist", target: "es2022" },
    server: { host: true },
  };
});
