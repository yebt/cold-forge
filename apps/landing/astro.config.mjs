// @ts-check
import { defineConfig, envField } from "astro/config";

/**
 * Production origins. Override at build time with SITE_URL / APP_URL (Cloudflare Pages env vars),
 * see docs/deploy.md. SITE_URL feeds canonical, hreflang and OG URLs.
 */
const site = process.env.SITE_URL ?? "https://coldforge.work";

export default defineConfig({
  site,
  output: "static",
  trailingSlash: "always",
  build: { format: "directory" },
  env: {
    schema: {
      /** The installable web app (PWA). */
      APP_URL: envField.string({ context: "client", access: "public", url: true, default: "https://app.coldforge.work" }),
      /** Signed Android build attached to the latest GitHub release by .github/workflows/android.yml. */
      APK_URL: envField.string({
        context: "client",
        access: "public",
        url: true,
        default: "https://github.com/yebt/cold-forge/releases/latest/download/cold-forge.apk",
      }),
    },
  },
  i18n: {
    locales: ["en", "es", "pt"],
    defaultLocale: "en",
    routing: {
      prefixDefaultLocale: true,
      // `/` is our own tiny locale picker (src/pages/index.astro), not a hard redirect to /en/.
      redirectToDefaultLocale: false,
    },
  },
  vite: {
    // Workspace packages ship raw TypeScript (`exports: ./src/index.ts`); let Vite compile them.
    ssr: { noExternal: ["@cold-forge/core", "@cold-forge/i18n"] },
  },
});
