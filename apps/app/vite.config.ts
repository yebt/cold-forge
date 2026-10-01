import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the bundle also loads from Capacitor's file-based webview.
  base: "./",
  build: { outDir: "dist", target: "es2022" },
  server: { host: true },
});
