import type { AppData } from "./model.ts";
import { parseAppData } from "./parse.ts";

/** Minimal async key-value store: Capacitor Preferences on device, memory in tests. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * The only thing the UI talks to for persistence. Swappable for a syncing implementation later
 * (records already carry `updatedAt` for last-write-wins merges).
 */
export interface Repository {
  load(): Promise<AppData | null>;
  save(data: AppData): Promise<void>;
  clear(): Promise<void>;
}

export const STORAGE_KEY = "coldforge.data.v1";

export function createRepository(store: KeyValueStore, key = STORAGE_KEY): Repository {
  return {
    async load() {
      const raw = await store.get(key);
      if (!raw) return null;
      try {
        return parseAppData(JSON.parse(raw));
      } catch {
        return null;
      }
    },
    async save(data) {
      await store.set(key, JSON.stringify(data));
    },
    async clear() {
      await store.remove(key);
    },
  };
}

export function createMemoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const map = new Map(Object.entries(initial));
  return {
    async get(k) {
      return map.get(k) ?? null;
    },
    async set(k, v) {
      map.set(k, v);
    },
    async remove(k) {
      map.delete(k);
    },
  };
}

/** Pretty JSON for "export my data". */
export function exportJSON(data: AppData): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), app: "cold-forge", data }, null, 2);
}
