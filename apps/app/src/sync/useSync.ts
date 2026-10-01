import { useSyncExternalStore } from "react";
import type { SyncSnapshot } from "../lib/sync/engine.ts";
import { syncEngine } from "./runtime.ts";

export function useSync(): SyncSnapshot {
  return useSyncExternalStore(syncEngine.subscribe, syncEngine.getSnapshot);
}
