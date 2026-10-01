import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

/** Foreground / background changes (native app state, or page visibility on the web). */
export function onForegroundChange(cb: (active: boolean) => void): () => void {
  if (Capacitor.isNativePlatform()) {
    const handle = App.addListener("appStateChange", ({ isActive }) => cb(isActive));
    return () => void handle.then((h) => h.remove());
  }
  const onVisibility = () => cb(document.visibilityState === "visible");
  document.addEventListener("visibilitychange", onVisibility);
  return () => document.removeEventListener("visibilitychange", onVisibility);
}
