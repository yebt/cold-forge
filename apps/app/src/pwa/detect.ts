/** Pure environment checks for install UX, written against minimal shapes so they are unit-testable. */

export interface NavigatorLike {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  /** iOS Safari: true when launched from the home screen. */
  standalone?: boolean;
}

export function isIos(nav: NavigatorLike): boolean {
  if (/iPad|iPhone|iPod/.test(nav.userAgent)) return true;
  // iPadOS 13+ reports itself as a Mac; touch support gives it away.
  return nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1;
}

/** Safari proper (not Chrome/Firefox/Edge/in-app webviews on iOS), where "Add to Home Screen" lives in the Share menu. */
export function isIosSafari(nav: NavigatorLike): boolean {
  if (!isIos(nav)) return false;
  const ua = nav.userAgent;
  if (/CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|DuckDuckGo|GSA\/|FBAN|FBAV|Instagram|Line\//.test(ua)) return false;
  return /Safari\//.test(ua) && /Version\//.test(ua);
}

export function isStandalone(nav: NavigatorLike, matches: (query: string) => boolean): boolean {
  return nav.standalone === true || matches("(display-mode: standalone)") || matches("(display-mode: fullscreen)");
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const INSTALL_DISMISSED_KEY = "cf.pwa.installDismissed";

/** Storage can throw (private mode, blocked cookies): treat that as "not dismissed" and move on. */
export function readDismissed(storage: () => StorageLike | undefined): boolean {
  try {
    return storage()?.getItem(INSTALL_DISMISSED_KEY) != null;
  } catch {
    return false;
  }
}

export function writeDismissed(storage: () => StorageLike | undefined, now = new Date()): void {
  try {
    storage()?.setItem(INSTALL_DISMISSED_KEY, now.toISOString());
  } catch {
    // Not remembered; the banner is still hidden for this session.
  }
}

export type InstallMode = "prompt" | "ios" | null;

/** What install UI to offer: the native prompt if the browser gave us one, iOS instructions, or nothing. */
export function installMode(input: {
  native: boolean;
  standalone: boolean;
  hasPrompt: boolean;
  iosSafari: boolean;
}): InstallMode {
  if (input.native || input.standalone) return null;
  if (input.hasPrompt) return "prompt";
  if (input.iosSafari) return "ios";
  return null;
}
