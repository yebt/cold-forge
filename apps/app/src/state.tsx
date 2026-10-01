import { localToday, type ISODate } from "@cold-forge/core";
import { createContext, useContext } from "react";
import type { Translations } from "./i18n/index.ts";
import type { Derived } from "./lib/derive.ts";
import type { AppData } from "./lib/model.ts";

export type Updater = (data: AppData, now: string) => AppData;

export interface AppState {
  data: AppData;
  today: ISODate;
  t: Translations;
  derived: Derived;
  update: (fn: Updater) => void;
  reset: () => Promise<void>;
  /** Re-opens the "which arc to keep" dialog after "Decide later". */
  showConflict: () => void;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp outside AppContext");
  return ctx;
}

export const nowISO = () => new Date().toISOString();
export const todayLocal = () => localToday();
