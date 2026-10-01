import type { AccountInfo, SyncBackend } from "../lib/sync/backend.ts";
import { err, ok } from "../lib/sync/errors.ts";
import { createFirestoreTransport, type FirestoreTransport, type WriteOp } from "../lib/sync/firestoreTransport.ts";
import { createMemoryFirestore } from "../lib/sync/memoryFirestore.ts";

/**
 * UI-test backend (`VITE_FIREBASE_MOCK=1` only; dead code in production builds). It runs the real
 * Firestore transport over the in-memory Firestore, persisted in localStorage, and exposes
 * `window.__cfMock` so a test can act as "another device" or the auth server.
 */
const STORE_KEY = "coldforge.mockFirestore";
const AUTH_KEY = "coldforge.mockAuth";

export interface MockControls {
  /** Writes as another device (realtime listeners fire). */
  remoteWrite(ops: WriteOp[]): Promise<void>;
  docs(): Record<string, Record<string, unknown>>;
  /** Ends the session as if revoked server-side. */
  revoke(): void;
  /** Blocks / unblocks the mock user server-side (blocked/{uid}). */
  block(on?: boolean): void;
  failNext(...codes: (string | null)[]): void;
  /** Next sign-in / re-auth popup is closed by the user. */
  cancelNextPopup(): void;
  stats(): { reads: number; writes: number; commits: number };
}

declare global {
  interface Window {
    __cfMock?: MockControls;
  }
}

export function createMockBackend(): SyncBackend {
  const fs = createMemoryFirestore({ enforceRules: true });
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) fs.load(saved);
  } catch {
    /* empty */
  }
  const save = () => {
    try {
      localStorage.setItem(STORE_KEY, fs.dump());
    } catch {
      /* ignore */
    }
  };
  const commit = fs.port.commit;
  fs.port.commit = async (ops) => {
    await commit(ops);
    save();
  };

  const readUser = (): AccountInfo | null => {
    try {
      const v = JSON.parse(localStorage.getItem(AUTH_KEY) ?? "null") as AccountInfo | null;
      return v && typeof v.uid === "string" ? v : null;
    } catch {
      return null;
    }
  };
  let user = readUser();
  let cancelPopup = false;
  const signedOutListeners = new Set<() => void>();
  const transports = new Map<string, FirestoreTransport>();
  const transportFor = (uid: string) => {
    let t = transports.get(uid);
    if (!t) transports.set(uid, (t = createFirestoreTransport(fs.port, uid)));
    return t;
  };
  const popup = async () => {
    await new Promise((r) => setTimeout(r, 150));
    if (cancelPopup) {
      cancelPopup = false;
      return false;
    }
    return true;
  };

  window.__cfMock = {
    async remoteWrite(ops) {
      await fs.commit(ops);
      save();
    },
    docs: () => Object.fromEntries(fs.docs()),
    revoke() {
      user = null;
      localStorage.removeItem(AUTH_KEY);
      signedOutListeners.forEach((l) => l());
    },
    block(on = true) {
      fs.setBlocked("mock-uid", on);
      save();
    },
    failNext: (...codes) => fs.failNext(...codes),
    cancelNextPopup: () => void (cancelPopup = true),
    stats: () => ({ ...fs.stats }),
  };

  return {
    restore: async () => ok(user),
    async signIn() {
      if (!(await popup())) return err({ kind: "cancelled" });
      user = { uid: "mock-uid", email: "tester@gmail.com" };
      localStorage.setItem(AUTH_KEY, JSON.stringify(user));
      return ok(user);
    },
    async signOut() {
      user = null;
      localStorage.removeItem(AUTH_KEY);
    },
    async deleteAccount() {
      if (!user) return err({ kind: "unauthorized" });
      if (!(await popup())) return err({ kind: "cancelled" });
      // user.delete(); the onUserDeleted function then removes its data (and blocks the uid,
      // which the mock skips: a real re-sign-up gets a new uid, the mock reuses "mock-uid").
      fs.deleteUserData(user.uid);
      save();
      user = null;
      localStorage.removeItem(AUTH_KEY);
      return ok(undefined);
    },
    onSignedOut(cb) {
      signedOutListeners.add(cb);
      return () => signedOutListeners.delete(cb);
    },
    transport: transportFor,
  };
}
