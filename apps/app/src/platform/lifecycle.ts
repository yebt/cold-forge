import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { parseAuthHash, parseAuthUrl } from "../lib/authLink.ts";

/** Calls `cb` when the app comes back to the foreground or the network returns. */
export function onResumeOrOnline(cb: () => void): () => void {
  const cleanups: (() => void)[] = [];
  if (Capacitor.isNativePlatform()) {
    const handle = App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) cb();
    });
    cleanups.push(() => void handle.then((h) => h.remove()));
  } else {
    const onVisible = () => {
      if (document.visibilityState === "visible") cb();
    };
    document.addEventListener("visibilitychange", onVisible);
    cleanups.push(() => document.removeEventListener("visibilitychange", onVisible));
  }
  addEventListener("online", cb);
  cleanups.push(() => removeEventListener("online", cb));
  return () => cleanups.forEach((c) => c());
}

/**
 * Takes the sign-in token out of `#/auth?token=…` and immediately removes it from the address
 * bar and history, whether or not it turns out valid. `null` = no auth link; `{ token: null }` =
 * an auth link with a malformed token.
 */
export function takeAuthTokenFromLocation(): { token: string | null } | null {
  if (typeof location === "undefined" || !location.hash.startsWith("#/auth")) return null;
  const token = parseAuthHash(location.hash);
  // Malformed links are stripped too, and reported as invalid rather than silently ignored.
  try {
    history.replaceState(null, "", location.pathname + location.search);
  } catch {
    location.hash = "";
  }
  return { token };
}

/** Native deep links (once universal/app links point at the app). */
export function onAuthDeepLink(cb: (token: string) => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => undefined;
  const handle = App.addListener("appUrlOpen", ({ url }) => {
    const token = parseAuthUrl(url);
    if (token) cb(token);
  });
  return () => void handle.then((h) => h.remove());
}
