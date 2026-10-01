import type { SyncResult } from "./errors.ts";
import type { SyncTransport } from "./transport.ts";

export interface AccountInfo {
  uid: string;
  /** As the identity provider returns it. */
  email: string;
}

/**
 * Account + transport for one backend (Firebase in production, an in-memory fake in tests and
 * mock builds). Loaded lazily: guest mode never creates one.
 */
export interface SyncBackend {
  /** The user signed in on this device (from the SDK's own persistence), finishing a redirect if one is pending. */
  restore(): Promise<SyncResult<AccountInfo | null>>;
  /** User-initiated (button) Google sign-in. */
  signIn(): Promise<SyncResult<AccountInfo>>;
  signOut(): Promise<void>;
  /** Re-authenticates, deletes every server document of the user, then the account itself. */
  deleteAccount(): Promise<SyncResult<void>>;
  /** Fires when the session ends outside our control (revoked, deleted elsewhere). */
  onSignedOut(cb: () => void): () => void;
  transport(uid: string): SyncTransport;
}
