import { initializeApp } from "firebase/app";
import { ReCaptchaEnterpriseProvider, initializeAppCheck } from "firebase/app-check";
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
import type { AdminErrorDetails, WhoAmIResponse } from "./types.ts";
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
  /** reCAPTCHA Enterprise site key: App Check on (callables then carry a token). "" = off. */
  appCheckSiteKey: string;
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
    appCheckSiteKey: env.VITE_APPCHECK_SITE_KEY ?? "",
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
  if (config.appCheckSiteKey && !config.emulators) {
    // Required before setting ADMIN_ENFORCE_APP_CHECK=true on the functions (docs/deploy.md).
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(config.appCheckSiteKey), isTokenAutoRefreshEnabled: true });
  }
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
  let pendingEmail: string | undefined;
  /** Bumped on every auth change, so a slow adminWhoAmI answer for an older user is ignored. */
  let generation = 0;
  const listeners = new Set<(s: AuthState) => void>();
  const emit = (next: AuthState) => {
    state = next;
    for (const l of listeners) l(state);
  };

  async function call(name: string, data: unknown): Promise<unknown> {
    try {
      const fn = httpsCallable(functions, name, { timeout: 120_000 });
      return (await fn(data)).data;
    } catch (error) {
      if (error instanceof FunctionsError) {
        const details = (error.details ?? {}) as AdminErrorDetails;
        throw new CallError(error.code.replace(/^functions\//, ""), error.message, details.reason);
      }
      throw new CallError("internal", "Network error. Try again.", undefined);
    }
  }

  /**
   * The server decides who is an admin (verified Google email in ADMIN_ALLOWED_EMAILS plus a live
   * account check): the panel only asks it. No claim or allowlist is evaluated in the browser.
   */
  async function whoAmI(): Promise<{ ok: true; email: string } | { ok: false; denied: boolean }> {
    try {
      const res = (await call("adminWhoAmI", {})) as WhoAmIResponse | null;
      return res?.isAdmin === true ? { ok: true, email: res.email } : { ok: false, denied: true };
    } catch (error) {
      const denied = error instanceof CallError && (error.code === "permission-denied" || error.code === "unauthenticated");
      return { ok: false, denied };
    }
  }

  async function deny(notice: "denied" | "error", email: string | null) {
    pendingNotice = notice;
    pendingEmail = notice === "denied" ? (email ?? undefined) : undefined;
    await signOut(auth);
  }

  /** After sign-in (or a restored session): only a server-confirmed admin gets past the sign-in screen. */
  async function evaluate(user: User | null) {
    const gen = ++generation;
    if (!user) {
      emit({ status: "signed-out", notice: pendingNotice, email: pendingEmail });
      pendingNotice = undefined;
      pendingEmail = undefined;
      return;
    }
    const res = await whoAmI();
    if (gen !== generation) return;
    if (!res.ok) {
      await deny(res.denied ? "denied" : "error", user.email);
      return;
    }
    emit({
      status: "ready",
      session: { uid: user.uid, email: res.email, displayName: user.displayName, photoURL: user.photoURL },
    });
  }

  // onIdTokenChanged also fires on every token refresh (hourly), so an admin who was removed from
  // the allowlist, disabled or revoked is signed out even if the panel stays open (the server
  // refuses their calls immediately anyway). A transient error on a refresh signs nobody out.
  onIdTokenChanged(auth, (user) => {
    if (user && state.status === "ready" && state.session.uid === user.uid) {
      const gen = generation;
      void whoAmI().then((res) => {
        if (gen === generation && !res.ok && res.denied) void deny("denied", user.email);
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
      pendingEmail = undefined;
      await signOut(auth);
    },
    async reauthenticate() {
      if (!auth.currentUser) throw new CallError("unauthenticated", "Not signed in.", undefined);
      await reauthenticateWithPopup(auth.currentUser, provider());
      await auth.currentUser.getIdToken(true);
    },
    async call(name, data) {
      return (await call(name, data)) as never;
    },
  };
}
