/**
 * Fails if anything from the dev-only mock layer reached the production bundle.
 * Run after `vite build` (`bun run check:bundle`).
 */
import { readdir, readFile } from "node:fs/promises";

const MARKERS = ["createMockBackend", "MOCK DATA", "VITE_ADMIN_MOCK", "owner@coldforge.work", "Mateus Oliveira", "seedAudit"];
const dir = new URL("./dist/assets/", import.meta.url);
const files = (await readdir(dir)).filter((f) => f.endsWith(".js"));
if (files.length === 0) throw new Error("dist/assets has no JS: run `vite build` first.");
const hits: string[] = [];
for (const file of files) {
  const text = await readFile(new URL(file, dir), "utf8");
  for (const m of MARKERS) if (text.includes(m)) hits.push(`${file}: ${m}`);
}
if (hits.length) {
  console.error(`Mock code found in the production bundle:\n${hits.join("\n")}`);
  process.exit(1);
}
console.log(`ok: ${files.length} bundle file(s), no mock code`);
