import { localToday } from "@cold-forge/core";
import { redirectPending } from "../firebase/config.ts";
import type { AppData } from "../lib/model.ts";
import type { SyncBackend } from "../lib/sync/backend.ts";
import { createSyncEngine } from "../lib/sync/engine.ts";
import { onForegroundChange } from "../platform/lifecycle.ts";
import { syncStorage } from "../platform/syncStorage.ts";

/**
 * The Firebase SDK is only ever loaded here, through a dynamic import, when the user taps
 * "Sign in with Google" or a previous session/redirect needs it. Guest mode never fetches it.
 */
function loadBackend(): Promise<SyncBackend> {
  // Must stay a literal `import.meta.env` comparison: Vite inlines it, so the minifier drops the
  // mock branch (and its chunk) from production builds. Checked in the bundle by the e2e run.
  if (import.meta.env.VITE_FIREBASE_MOCK === "1") {
    return import("../firebase/mockBackend.ts").then((m) => m.createMockBackend());
  }
  return import("../firebase/firebaseBackend.ts").then((m) => m.createFirebaseBackend());
}

/**
 * The one sync engine of the app. Module-level (not created in a React effect) so StrictMode
 * double-mounts and HMR never create two engines racing over the same storage.
 */
let binding: { getData: () => AppData | null; setData: (d: AppData) => void } = {
  getData: () => null,
  setData: () => undefined,
};

export const syncEngine = createSyncEngine({
  loadBackend,
  storage: syncStorage,
  getData: () => binding.getData(),
  setData: (d) => binding.setData(d),
  today: () => localToday(),
  redirectPending,
});

export function bindAppData(b: typeof binding): void {
  binding = b;
}

let started = false;

/** Starts syncing. Call once the app's own data has been loaded (so sync never sees a fake "empty device"). */
export function startSync(): void {
  if (started) return;
  started = true;
  void syncEngine.init();
  // Realtime listeners only while the app is visible; a sync on every return to the foreground.
  onForegroundChange((active) => syncEngine.setForeground(active));
  syncEngine.setForeground(typeof document === "undefined" || document.visibilityState !== "hidden");
  addEventListener("online", () => void syncEngine.requestSync("online"));
}
