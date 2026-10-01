import { initializeApp } from "firebase/app";
import {
  browserPopupRedirectResolver,
  browserSessionPersistence,
  connectAuthEmulator,
  GoogleAuthProvider,
  initializeAuth,
  onIdTokenChanged,
  reauthenticateWithPopup,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable, FunctionsError } from "firebase/functions";
import type { AdminErrorDetails } from "./types.ts";
import { CallError, type AuthState, type Backend } from "./types.ts";

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  messagingSenderId?: string;
  storageBucket?: string;
  region: string;
  emulators: boolean;
}

export function readConfig(): FirebaseWebConfig {
  const env = import.meta.env;
  return {
    apiKey: env.VITE_FIREBASE_API_KEY ?? "",
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? "",
    appId: env.VITE_FIREBASE_APP_ID ?? "",
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || undefined,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || undefined,
    region: env.VITE_FUNCTIONS_REGION || "us-central1",
    // Never honoured in production builds (vite.config.ts also refuses the flag there).
    emulators: import.meta.env.DEV && env.VITE_USE_EMULATORS === "1",
  };
}

function provider(): GoogleAuthProvider {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: "select_account" });
  return p;
}

export function createFirebaseBackend(config: FirebaseWebConfig): Backend {
  const app = initializeApp({
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    appId: config.appId,
    messagingSenderId: config.messagingSenderId,
    storageBucket: config.storageBucket,
  });
  // Session (tab) persistence only: closing the tab ends the admin session, and nothing lands in
  // IndexedDB/localStorage. Explicit popup resolver = no redirect-flow code paths.
  const auth = initializeAuth(app, {
    persistence: browserSessionPersistence,
    popupRedirectResolver: browserPopupRedirectResolver,
  });
  const functions = getFunctions(app, config.region);
  if (config.emulators) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  }

  let state: AuthState = { status: "loading" };
  let pendingNotice: "denied" | "expired" | "idle" | "error" | undefined;
  const listeners = new Set<(s: AuthState) => void>();
  const emit = (next: AuthState) => {
    state = next;
    for (const l of listeners) l(state);
  };

  /** Only a fresh token with `admin: true` and a verified email gets past the sign-in screen. */
  async function evaluate(user: User | null) {
    if (!user) {
      emit({ status: "signed-out", notice: pendingNotice });
      pendingNotice = undefined;
      return;
    }
    try {
      const token = await user.getIdTokenResult(true);
      const isAdmin = token.claims.admin === true && user.emailVerified && token.signInProvider === "google.com";
      if (!isAdmin) {
        pendingNotice = "denied";
        await signOut(auth);
        return;
      }
      emit({
        status: "ready",
        session: { uid: user.uid, email: user.email ?? "", displayName: user.displayName, photoURL: user.photoURL },
      });
    } catch {
      pendingNotice = "error";
      await signOut(auth);
    }
  }

  // onIdTokenChanged also fires on token refresh, so a claim removed server-side is noticed within
  // the hour even if the panel stays open (the server refuses it immediately anyway).
  onIdTokenChanged(auth, (user) => {
    if (user && state.status === "ready" && state.session.uid === user.uid) {
      void user.getIdTokenResult().then((t) => {
        if (t.claims.admin !== true) {
          pendingNotice = "denied";
          void signOut(auth);
        }
      });
      return;
    }
    void evaluate(user);
  });

  return {
    kind: "firebase",
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    async signIn() {
      await signInWithPopup(auth, provider());
    },
    async signOut(notice) {
      pendingNotice = notice;
      await signOut(auth);
    },
    async reauthenticate() {
      if (!auth.currentUser) throw new CallError("unauthenticated", "Not signed in.", undefined);
      await reauthenticateWithPopup(auth.currentUser, provider());
      await auth.currentUser.getIdToken(true);
    },
    async call(name, data) {
      try {
        const fn = httpsCallable(functions, name, { timeout: 120_000 });
        const result = await fn(data);
        return result.data as never;
      } catch (error) {
        if (error instanceof FunctionsError) {
          const details = (error.details ?? {}) as AdminErrorDetails;
          throw new CallError(error.code.replace(/^functions\//, ""), error.message, details.reason);
        }
        throw new CallError("internal", "Network error. Try again.", undefined);
      }
    },
  };
}
