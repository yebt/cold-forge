import { localToday } from "@cold-forge/core";
import type { AppData } from "../lib/model.ts";
import { createApiClient } from "../lib/sync/api.ts";
import { createSyncEngine } from "../lib/sync/engine.ts";
import { API_URL } from "../platform/config.ts";
import { onAuthDeepLink, onResumeOrOnline, takeAuthTokenFromLocation } from "../platform/lifecycle.ts";
import { syncStorage } from "../platform/syncStorage.ts";

/**
 * The one sync engine of the app. Module-level (not created in a React effect) so StrictMode
 * double-mounts and HMR never create two engines racing over the same storage.
 */
let binding: { getData: () => AppData | null; setData: (d: AppData) => void } = {
  getData: () => null,
  setData: () => undefined,
};

export const syncEngine = createSyncEngine({
  api: createApiClient({ baseUrl: API_URL }),
  storage: syncStorage,
  getData: () => binding.getData(),
  setData: (d) => binding.setData(d),
  today: () => localToday(),
});

/** Strip a sign-in token from the URL as early as possible (module load, before rendering). */
const pendingLink = takeAuthTokenFromLocation();

function handleLink(link: { token: string | null } | null): void {
  if (!link) return;
  if (link.token) void syncEngine.signInWithLinkToken(link.token);
  else syncEngine.reportInvalidLink(); // never sent to the server
}

export function bindAppData(b: typeof binding): void {
  binding = b;
}

let started = false;

/** Starts syncing. Call once the app's own data has been loaded (so sync never sees a fake "empty device"). */
export function startSync(): void {
  if (started) return;
  started = true;
  void syncEngine.init().then(() => {
    handleLink(pendingLink);
  });
  onResumeOrOnline(() => void syncEngine.requestSync("resume"));
  onAuthDeepLink((token) => void syncEngine.signInWithLinkToken(token));
  // The link can also land in a tab where the app is already open.
  addEventListener("hashchange", () => handleLink(takeAuthTokenFromLocation()));
}
