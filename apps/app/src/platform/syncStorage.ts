import { Preferences } from "@capacitor/preferences";
import type { SyncStorage } from "../lib/sync/engine.ts";

/**
 * Session token and sync bookkeeping, in keys separate from the app data.
 *
 * Capacitor Preferences is UserDefaults / SharedPreferences on device and localStorage on the
 * web — not encrypted. Before launch, the session should move to a Keychain/Keystore-backed
 * plugin (e.g. capacitor-secure-storage). On the web the strict CSP in index.html is what keeps
 * injected scripts away from it.
 */
export const SESSION_KEY = "coldforge.session.v1";
export const SYNC_STATE_KEY = "coldforge.sync.v1";

export const syncStorage: SyncStorage = {
  async loadSession() {
    return (await Preferences.get({ key: SESSION_KEY })).value;
  },
  async saveSession(value) {
    await Preferences.set({ key: SESSION_KEY, value });
  },
  async clearSession() {
    await Preferences.remove({ key: SESSION_KEY });
  },
  async loadState() {
    return (await Preferences.get({ key: SYNC_STATE_KEY })).value;
  },
  async saveState(value) {
    await Preferences.set({ key: SYNC_STATE_KEY, value });
  },
};
