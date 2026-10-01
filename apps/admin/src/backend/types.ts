import type { AdminCallableName, AdminCallables, AdminErrorDetails } from "../../../functions/src/api.ts";

export type * from "../../../functions/src/api.ts";

export interface Session {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
}

export type AuthState =
  | { status: "loading" }
  | { status: "signed-out"; notice?: "denied" | "expired" | "idle" | "error"; email?: string }
  | { status: "ready"; session: Session };

/**
 * Everything the UI needs from the outside world. The real implementation is Firebase Auth +
 * callables (`firebase.ts`); dev can swap in fixtures (`mock.ts`). The UI never reads Firestore.
 */
export interface Backend {
  readonly kind: "firebase" | "mock";
  /** Shown in the sidebar when set (mock mode). */
  readonly banner?: string;
  subscribe(listener: (state: AuthState) => void): () => void;
  signIn(): Promise<void>;
  signOut(notice?: "denied" | "expired" | "idle"): Promise<void>;
  /** Fresh Google sign-in for destructive actions (server requires a recent `auth_time`). */
  reauthenticate(): Promise<void>;
  call<K extends AdminCallableName>(name: K, data: AdminCallables[K][0]): Promise<AdminCallables[K][1]>;
}

export class CallError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly reason: AdminErrorDetails["reason"] | undefined,
  ) {
    super(message);
    this.name = "CallError";
  }
}
