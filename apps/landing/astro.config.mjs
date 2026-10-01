// @ts-check
import { defineConfig } from "astro/config";

// TODO: set the real production origin (used for canonical, hreflang and OG URLs).
const site = process.env.SITE_URL ?? "https://coldforge.app";

export default defineConfig({
  site,
  output: "static",
  trailingSlash: "always",
  build: { format: "directory" },
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
