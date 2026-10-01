/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Firebase web config (public values; see .env.example). */
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  /** "1": connect to the local Auth (9099) and Firestore (8080) emulators. */
  readonly VITE_USE_EMULATORS?: string;
  /** "1": in-memory fake backend for UI tests. Never set it for a production build. */
  readonly VITE_FIREBASE_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
