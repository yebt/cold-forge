import { describe, expect, test } from "bun:test";
import { INSTALL_DISMISSED_KEY, installMode, isIos, isIosSafari, isStandalone, readDismissed, writeDismissed } from "./detect.ts";
import { PWA_MESSAGES, pwaLocale } from "./messages.ts";
import { createStore } from "./store.ts";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
  iphoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0",
  ipadDesktop:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  android:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
};

describe("platform detection", () => {
  test("iOS Safari, including iPadOS posing as a Mac", () => {
    expect(isIosSafari({ userAgent: UA.iphoneSafari })).toBe(true);
    expect(isIosSafari({ userAgent: UA.ipadDesktop, platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: UA.ipadDesktop, platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
  });
  test("other iOS browsers and in-app webviews are not Safari", () => {
    expect(isIosSafari({ userAgent: UA.iphoneChrome })).toBe(false);
    expect(isIosSafari({ userAgent: UA.iphoneInstagram })).toBe(false);
    expect(isIosSafari({ userAgent: UA.android })).toBe(false);
  });
  test("standalone via navigator.standalone or display-mode", () => {
    expect(isStandalone({ userAgent: "", standalone: true }, () => false)).toBe(true);
    expect(isStandalone({ userAgent: "" }, (q) => q === "(display-mode: standalone)")).toBe(true);
    expect(isStandalone({ userAgent: "" }, () => false)).toBe(false);
  });
});

describe("installMode", () => {
  const base = { native: false, standalone: false, hasPrompt: false, iosSafari: false };
  test("prefers the native prompt, then iOS steps", () => {
    expect(installMode({ ...base, hasPrompt: true })).toBe("prompt");
    expect(installMode({ ...base, iosSafari: true })).toBe("ios");
    expect(installMode(base)).toBe(null);
  });
  test("never offers install inside the native shell or an installed app", () => {
    expect(installMode({ ...base, hasPrompt: true, native: true })).toBe(null);
    expect(installMode({ ...base, iosSafari: true, standalone: true })).toBe(null);
  });
});

describe("dismissal memory", () => {
  test("round-trips through storage", () => {
    const map = new Map<string, string>();
    const storage = () => ({ getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) });
    expect(readDismissed(storage)).toBe(false);
    writeDismissed(storage, new Date("2026-10-01T00:00:00Z"));
    expect(map.get(INSTALL_DISMISSED_KEY)).toBe("2026-10-01T00:00:00.000Z");
    expect(readDismissed(storage)).toBe(true);
  });
  test("survives storage that throws", () => {
    const throwing = () => ({
      getItem: (): string | null => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
    });
    expect(readDismissed(throwing)).toBe(false);
    expect(() => writeDismissed(throwing)).not.toThrow();
    expect(readDismissed(() => undefined)).toBe(false);
  });
});

describe("messages", () => {
  test("every locale has the same keys and the iOS step keeps its icon slot", () => {
    const keys = Object.keys(PWA_MESSAGES.en).sort();
    for (const m of Object.values(PWA_MESSAGES)) {
      expect(Object.keys(m).sort()).toEqual(keys);
      expect(m.iosStep1).toContain("{icon}");
    }
  });
  test("locale comes from <html lang>, then the browser", () => {
    expect(pwaLocale("pt", ["en-US"])).toBe("pt");
    expect(pwaLocale("", ["es-MX", "en"])).toBe("es");
    expect(pwaLocale(null, ["fr"])).toBe("en");
  });
});

describe("store", () => {
  test("notifies only on real changes", () => {
    const store = createStore({ needRefresh: false, offlineReady: false });
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.set({ needRefresh: false });
    expect(calls).toBe(0);
    store.set({ needRefresh: true });
    expect(store.get().needRefresh).toBe(true);
    expect(calls).toBe(1);
    off();
    store.set({ offlineReady: true });
    expect(calls).toBe(1);
  });
});
