import { Capacitor } from "@capacitor/core";
import { useSyncExternalStore } from "react";
import { registerSW } from "virtual:pwa-register";
import { installMode, isIosSafari, isStandalone, readDismissed, writeDismissed, type InstallMode } from "./detect.ts";
import { createStore } from "./store.ts";

/** Chromium's `beforeinstallprompt` event (not in lib.dom). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface PwaState {
  /** A new service worker is waiting; reloading activates it. */
  needRefresh: boolean;
  offlineReady: boolean;
  /** The browser offered an install prompt we can trigger. */
  canPrompt: boolean;
  /** Running as an installed app (or just installed). */
  installed: boolean;
  /** The user closed the install banner (remembered in localStorage). */
  dismissed: boolean;
}

const storage = () => (typeof localStorage === "undefined" ? undefined : localStorage);
const matches = (q: string) => typeof matchMedia === "function" && matchMedia(q).matches;
const native = () => Capacitor.isNativePlatform();

export const pwaStore = createStore<PwaState>({
  needRefresh: false,
  offlineReady: false,
  canPrompt: false,
  installed: false,
  dismissed: false,
});

let started = false;
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;

const UPDATE_CHECK_MS = 60 * 60 * 1000;

/**
 * Registers the service worker and starts listening for install prompts. Call once, before the
 * first render, so an early `beforeinstallprompt` isn't missed. No-op in the native shells
 * (Capacitor serves the bundle itself) and in browsers without service workers.
 */
export function startPwa(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  pwaStore.set({
    installed: native() || isStandalone(navigator, matches),
    dismissed: readDismissed(storage),
  });
  if (native()) return;

  addEventListener("beforeinstallprompt", (event) => {
    // Keep Chrome's mini-infobar away; we show our own, once.
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    pwaStore.set({ canPrompt: true });
  });
  addEventListener("appinstalled", () => {
    deferredPrompt = null;
    pwaStore.set({ canPrompt: false, installed: true });
  });

  if (!("serviceWorker" in navigator)) return;
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => pwaStore.set({ needRefresh: true }),
    onOfflineReady: () => pwaStore.set({ offlineReady: true }),
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => {
        if (navigator.onLine && document.visibilityState === "visible") void registration.update().catch(() => {});
      };
      setInterval(check, UPDATE_CHECK_MS);
      document.addEventListener("visibilitychange", check);
    },
  });
}

/** Activates the waiting service worker and reloads into the new version. */
export function applyUpdate(): void {
  if (updateSW) void updateSW(true);
  else location.reload();
}

export function dismissUpdate(): void {
  pwaStore.set({ needRefresh: false });
}

export function dismissOfflineReady(): void {
  pwaStore.set({ offlineReady: false });
}

/** Shows the browser's install dialog. Resolves true when the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const event = deferredPrompt;
  if (!event) return false;
  deferredPrompt = null;
  pwaStore.set({ canPrompt: false });
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === "accepted") pwaStore.set({ installed: true });
  return outcome === "accepted";
}

/** Hides the install banner for good on this browser. */
export function dismissInstall(): void {
  writeDismissed(storage);
  pwaStore.set({ dismissed: true });
}

export function usePwaState(): PwaState {
  return useSyncExternalStore(pwaStore.subscribe, pwaStore.get, pwaStore.get);
}

export interface InstallInfo {
  /** "prompt": native install dialog available; "ios": show Share → Add to Home Screen steps. */
  mode: InstallMode;
  /** The user already closed the banner once; banners should stay hidden (explicit buttons may still show). */
  dismissed: boolean;
  install: () => Promise<boolean>;
  dismiss: () => void;
}

export function useInstall(): InstallInfo {
  const s = usePwaState();
  const mode = installMode({
    native: typeof window !== "undefined" && native(),
    standalone: s.installed,
    hasPrompt: s.canPrompt,
    iosSafari: typeof navigator !== "undefined" && isIosSafari(navigator),
  });
  return { mode, dismissed: s.dismissed, install: promptInstall, dismiss: dismissInstall };
}
