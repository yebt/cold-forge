import type { Locale } from "@cold-forge/i18n";
import { useEffect } from "react";
import { PWA_MESSAGES, pwaLocale } from "./messages.ts";
import { applyUpdate, dismissOfflineReady, dismissUpdate, usePwaState } from "./runtime.ts";
import "./pwa.css";

/** "New version available — Reload". Mounted once by `boot.tsx`, above everything else. */
export function UpdateToast({ locale }: { locale?: Locale }) {
  const { needRefresh, offlineReady } = usePwaState();
  const t = PWA_MESSAGES[locale ?? pwaLocale()];

  useEffect(() => {
    if (!offlineReady) return;
    const id = setTimeout(dismissOfflineReady, 3500);
    return () => clearTimeout(id);
  }, [offlineReady]);

  if (needRefresh) {
    return (
      <div className="pwa-toast" role="status" aria-live="polite">
        <span className="pwa-toast-text">{t.updateAvailable}</span>
        <button type="button" className="btn small ghost" onClick={dismissUpdate}>
          {t.later}
        </button>
        <button type="button" className="btn small primary" onClick={applyUpdate}>
          {t.reload}
        </button>
      </div>
    );
  }
  if (offlineReady) {
    return (
      <div className="pwa-toast pwa-toast-quiet" role="status" aria-live="polite" onClick={dismissOfflineReady}>
        <span className="pwa-toast-text">❄️ {t.offlineReady}</span>
      </div>
    );
  }
  return null;
}
