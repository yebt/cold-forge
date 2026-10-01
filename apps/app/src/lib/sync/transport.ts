import type { SyncChanges } from "@cold-forge/sync";
import type { SyncResult } from "./errors.ts";

/** One page of server changes after a cursor. */
export interface SyncPage {
  /** Opaque, transport-defined; `null` = from the beginning. */
  cursor: string;
  changes: SyncChanges;
  hasMore: boolean;
}

/**
 * The record channel between the engine and a backend. Merge, dirty tracking, history,
 * conflicts, batching, retries and backoff all live in the engine, so a backend only implements
 * this. Records handed to `push` are already validated (same rules as the server) and ordered
 * parents-first.
 */
export interface SyncTransport {
  /** Max records per `push` (one atomic write). */
  readonly maxPushRecords: number;
  /** Max distinct parents (arcs of habits, habits of check-ins) one push may reference. */
  readonly maxPushParents?: number;
  /** Everything that changed after `cursor`, one page at a time (follow `hasMore`). */
  pull(cursor: string | null): Promise<SyncResult<SyncPage>>;
  /** Writes records atomically. */
  push(changes: SyncChanges): Promise<SyncResult<void>>;
  /**
   * Realtime: calls `onPage` with changes made after `cursor` (by other devices) as they happen.
   * Optional; returns an unsubscribe function.
   */
  subscribe?(cursor: string | null, onPage: (page: SyncPage) => void, onError: (e: SyncResult<never>) => void): () => void;
  /** The later of two cursors (pages from pulls and realtime can arrive in any order). */
  maxCursor(a: string | null, b: string): string;
}
