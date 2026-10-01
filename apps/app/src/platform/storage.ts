import { Preferences } from "@capacitor/preferences";
import { createRepository, type KeyValueStore, type Repository } from "../lib/repository.ts";

/** Capacitor Preferences: native key-value storage on device, localStorage on the web. */
const preferencesStore: KeyValueStore = {
  async get(key) {
    return (await Preferences.get({ key })).value;
  },
  async set(key, value) {
    await Preferences.set({ key, value });
  },
  async remove(key) {
    await Preferences.remove({ key });
  },
};

export const repository: Repository = createRepository(preferencesStore);
