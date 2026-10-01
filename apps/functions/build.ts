/**
 * Bundles src/index.ts into lib/index.js for Cloud Functions (Node 22, ESM).
 *
 * Firebase deploys this folder and runs `npm install` in Cloud Build, where `workspace:*` deps can't
 * resolve. So everything except firebase-functions / firebase-admin (the only real `dependencies`)
 * is inlined here, including any `@cold-forge/*` workspace package imported now or later.
 */
import { rm } from "node:fs/promises";

const external = ["firebase-functions", "firebase-admin"];

await rm(new URL("./lib", import.meta.url), { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: [new URL("./src/index.ts", import.meta.url).pathname],
  outdir: new URL("./lib", import.meta.url).pathname,
  target: "node",
  format: "esm",
  // Keep firebase-functions/* subpaths external too.
  external: external.flatMap((name) => [name, `${name}/*`]),
  sourcemap: "linked",
  minify: false,
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// Cloud Build only installs `dependencies`; any other bare import would crash at cold start.
const allowed = /^(node:|firebase-functions(\/|$)|firebase-admin(\/|$))/;
for (const output of result.outputs) {
  if (!output.path.endsWith(".js")) continue;
  const code = await Bun.file(output.path).text();
  const specifiers = [...code.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s*"([^"]+)"|import\("([^"]+)"\)|require\("([^"]+)"\)/g)]
    .map((m) => m[1] ?? m[2] ?? m[3])
    .filter((s): s is string => !!s && !s.startsWith("."));
  const bad = [...new Set(specifiers.filter((s) => !allowed.test(s)))];
  if (bad.length) {
    console.error(`${output.path} imports packages that won't exist in Cloud Functions: ${bad.join(", ")}`);
    process.exit(1);
  }
  console.log(`built ${output.path} (external imports: ${[...new Set(specifiers)].join(", ")})`);
}
