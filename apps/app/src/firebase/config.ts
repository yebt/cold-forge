/**
 * Firebase web config from `VITE_FIREBASE_*` (public values; security comes from Auth + the
 * Firestore rules, not from hiding these). This module must not import the Firebase SDK: it is
 * read on the guest path to decide whether sign-in is available at all.
 */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  messagingSenderId: string;
  storageBucket: string;
}

const env = import.meta.env;

export function firebaseConfig(): FirebaseWebConfig | null {
  const c = {
    apiKey: env.VITE_FIREBASE_API_KEY ?? "",
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? "",
    appId: env.VITE_FIREBASE_APP_ID ?? "",
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
  };
  return c.apiKey && c.authDomain && c.projectId && c.appId ? c : null;
}

export const USE_EMULATORS = env.VITE_USE_EMULATORS === "1";
/** Mock backend for UI tests; `import.meta.env` is replaced at build time, so this is dead code in production. */
export const USE_MOCK = env.VITE_FIREBASE_MOCK === "1";

/** Sign-in can be offered when there is a config (or a mock/emulator setup). */
export function syncAvailable(): boolean {
  return USE_MOCK || firebaseConfig() !== null;
}

/** Set before `signInWithRedirect` so the next start loads Firebase to finish it. */
export const REDIRECT_FLAG = "coldforge.authRedirect";

export function redirectPending(): boolean {
  try {
    return localStorage.getItem(REDIRECT_FLAG) === "1";
  } catch {
    return false;
  }
}
