import type { Backend } from "./types.ts";

/**
 * Picks the data layer. `import.meta.env.DEV` is a compile-time `false` in `vite build`, so the
 * whole mock branch (and the `mock.ts` chunk) is eliminated from production bundles.
 */
export async function loadBackend(): Promise<Backend> {
  if (import.meta.env.DEV && import.meta.env.VITE_ADMIN_MOCK === "1") {
    const { createMockBackend } = await import("./mock.ts");
    return createMockBackend();
  }
  const { createFirebaseBackend, readConfig } = await import("./firebase.ts");
  return createFirebaseBackend(readConfig());
}
