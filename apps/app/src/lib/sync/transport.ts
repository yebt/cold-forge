import { SYNC_PROTOCOL_VERSION, type SyncChanges } from "@cold-forge/sync";
import type { ApiClient, ApiResult } from "./api.ts";
import type { SyncPage } from "./validate.ts";

/**
 * The only thing the sync engine needs from a backend: one exchange = push `changes` (already
 * validated, within per-request limits), then return one page of everything that changed after
 * `cursor` (including what was just written), with the next cursor and `hasMore`.
 *
 * Merge, dirty tracking, history, conflicts, batching, retries and backoff all stay in the engine,
 * so swapping the HTTP API for another backend (e.g. Firestore: batched writes + a query ordered
 * by a server timestamp) means implementing just this. Errors use the engine's error kinds
 * (`network`, `unauthorized`, `rate_limited`, `invalid_request`, `quota_exceeded`, `invalid_cursor`…).
 */
export interface SyncTransport {
  exchange(credential: string, request: { cursor: string | null; changes: SyncChanges }): Promise<ApiResult<SyncPage>>;
}

/** `POST /v1/sync` over the HTTP API client. */
export function httpTransport(api: Pick<ApiClient, "sync">): SyncTransport {
  return {
    exchange: (credential, { cursor, changes }) =>
      api.sync(credential, { protocol: SYNC_PROTOCOL_VERSION, cursor, changes }),
  };
}
