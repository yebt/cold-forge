import { Capacitor } from "@capacitor/core";
import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  GoogleAuthProvider,
  browserPopupRedirectResolver,
  connectAuthEmulator,
  getRedirectResult,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";
import { connectFirestoreEmulator, initializeFirestore, memoryLocalCache, type Firestore } from "firebase/firestore";
import type { AccountInfo, SyncBackend } from "../lib/sync/backend.ts";
import { err, ok, type SyncError, type SyncResult } from "../lib/sync/errors.ts";
import { createFirestoreTransport, type FirestoreTransport } from "../lib/sync/firestoreTransport.ts";
import { REDIRECT_FLAG, firebaseConfig } from "./config.ts";
import { firestorePort } from "./port.ts";

/**
 * The Firebase backend: Google sign-in + Firestore. Only ever reached through a dynamic import
 * (see src/sync/runtime.ts), so guest mode never downloads the SDK.
 *
 * - Web / PWA: `signInWithPopup`, falling back to `signInWithRedirect` when the popup is blocked
 *   or in iOS standalone mode (popups don't work there).
 * - Native (Capacitor): `@capacitor-firebase/authentication` shows the native Google account
 *   picker with `skipNativeAuth: true`, and we hand its Google ID token to the JS SDK
 *   (`signInWithCredential`). The JS SDK then owns the session, so Firestore and the rules see the
 *   same `request.auth` on every platform. Needs google-services.json (see docs/firebase.md).
 * - Auth state persists in IndexedDB. Firestore uses the memory cache: the app's own store is the
 *   source of truth, nothing is persisted twice.
 * - App Check (optional, off unless `VITE_APPCHECK_SITE_KEY` is set at build time): reCAPTCHA
 *   Enterprise on the web. Not used in the Capacitor APK (see docs/deploy.md, "App Check").
 */

/**
 * Build-time constants: Vite inlines them, so with no site key (the default) the App Check code is
 * dead and dropped, and the emulator branch never exists in a production bundle.
 */
const APPCHECK_SITE_KEY = import.meta.env.VITE_APPCHECK_SITE_KEY ?? "";

const isNative = () => Capacitor.isNativePlatform();

function isIOSStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || (/iPad|iPhone|iPod/.test(navigator.userAgent) && matchMedia("(display-mode: standalone)").matches);
}

const info = (u: User): AccountInfo => ({ uid: u.uid, email: u.email ?? "" });

function authError(e: unknown): SyncError {
  const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
  if (/popup-closed-by-user|cancelled-popup-request|user-cancelled|canceled|cancelled/i.test(code)) return { kind: "cancelled" };
  if (/network-request-failed|timeout/.test(code)) return { kind: "network" };
  if (/too-many-requests/.test(code)) return { kind: "rate_limited", retryAfterMs: 60_000 };
  if (/user-token-expired|user-disabled|user-not-found|invalid-user-token|requires-recent-login/.test(code)) return { kind: "unauthorized" };
  return { kind: "server" };
}

function setRedirectFlag(on: boolean) {
  try {
    if (on) localStorage.setItem(REDIRECT_FLAG, "1");
    else localStorage.removeItem(REDIRECT_FLAG);
  } catch {
    /* private mode: the redirect result is simply picked up when Firebase loads next */
  }
}

function googleProvider(): GoogleAuthProvider {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: "select_account" });
  return p;
}

/** Native Google sign-in; returns a credential for the JS SDK. */
async function nativeGoogleCredential() {
  const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
  const result = await FirebaseAuthentication.signInWithGoogle();
  const idToken = result.credential?.idToken;
  if (!idToken) throw Object.assign(new Error("no id token"), { code: "auth/user-cancelled" });
  return GoogleAuthProvider.credential(idToken, result.credential?.accessToken);
}

export async function createFirebaseBackend(): Promise<SyncBackend> {
  const config = firebaseConfig();
  if (!config) {
    const notConfigured = async () => err({ kind: "not_configured" });
    return {
      restore: async () => ok(null),
      signIn: notConfigured,
      signOut: async () => undefined,
      deleteAccount: notConfigured,
      onSignedOut: () => () => undefined,
      transport: () => {
        throw new Error("Firebase is not configured");
      },
    };
  }

  const app: FirebaseApp = initializeApp(config);
  if (APPCHECK_SITE_KEY && !isNative()) {
    // Loaded only when enabled (its own lazy chunk), and before Auth/Firestore make their first
    // request, so every request carries a token.
    const { ReCaptchaEnterpriseProvider, initializeAppCheck } = await import("firebase/app-check");
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(APPCHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
  }
  const auth: Auth = initializeAuth(app, {
    persistence: indexedDBLocalPersistence,
    ...(isNative() ? {} : { popupRedirectResolver: browserPopupRedirectResolver }),
  });
  const db: Firestore = initializeFirestore(app, { localCache: memoryLocalCache() });
  // Literal `import.meta.env.DEV`: false in `vite build`, so this branch (and the emulator hosts)
  // is compiled out of every build; vite.config.ts also refuses VITE_USE_EMULATORS=1 in production.
  if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === "1") {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }

  const transports = new Map<string, FirestoreTransport>();
  const transportFor = (uid: string) => {
    let t = transports.get(uid);
    if (!t) {
      t = createFirestoreTransport(firestorePort(db), uid, {
        onInvalidDocs: (n) => console.warn(`[sync] skipped ${n} invalid server document(s)`),
      });
      transports.set(uid, t);
    }
    return t;
  };

  return {
    async restore() {
      try {
        if (!isNative()) {
          const pending = localStorage.getItem(REDIRECT_FLAG) === "1";
          setRedirectFlag(false);
          if (pending) await getRedirectResult(auth);
        }
        await auth.authStateReady();
        return ok(auth.currentUser ? info(auth.currentUser) : null);
      } catch (e) {
        return err(authError(e));
      }
    },

    async signIn() {
      try {
        if (isNative()) {
          const cred = await signInWithCredential(auth, await nativeGoogleCredential());
          return ok(info(cred.user));
        }
        if (isIOSStandalone()) {
          setRedirectFlag(true);
          await signInWithRedirect(auth, googleProvider());
          return err({ kind: "redirecting" });
        }
        try {
          const cred = await signInWithPopup(auth, googleProvider());
          return ok(info(cred.user));
        } catch (e) {
          const code = String((e as { code?: unknown }).code ?? "");
          if (!/popup-blocked|operation-not-supported-in-this-environment/.test(code)) throw e;
          setRedirectFlag(true);
          await signInWithRedirect(auth, googleProvider());
          return err({ kind: "redirecting" });
        }
      } catch (e) {
        return err(authError(e));
      }
    },

    async signOut() {
      await signOut(auth);
      if (isNative()) {
        const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
        await FirebaseAuthentication.signOut().catch(() => undefined);
      }
    },

    async deleteAccount(): Promise<SyncResult<void>> {
      const user = auth.currentUser;
      if (!user) return err({ kind: "unauthorized" });
      try {
        // Deleting the account needs a recent login: confirm with Google first. Re-authenticating
        // as a different Google account fails (auth/user-mismatch), so it's always this user.
        if (isNative()) await reauthenticateWithCredential(user, await nativeGoogleCredential());
        else await reauthenticateWithPopup(user, googleProvider());
      } catch (e) {
        return err(authError(e));
      }
      try {
        // Clients can't delete Firestore documents. Deleting the Auth user fires onUserDeleted,
        // which blocks the uid (rules refuse it at once) and erases users/{uid} recursively.
        await user.delete();
      } catch (e) {
        return err(authError(e));
      }
      if (isNative()) {
        const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
        await FirebaseAuthentication.signOut().catch(() => undefined);
      }
      return ok(undefined);
    },

    onSignedOut(cb) {
      let had = auth.currentUser !== null;
      return onAuthStateChanged(auth, (u) => {
        if (u) had = true;
        else if (had) {
          had = false;
          cb();
        }
      });
    },

    transport: transportFor,
  };
}
