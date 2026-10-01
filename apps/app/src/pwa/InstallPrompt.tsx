import type { Locale } from "@cold-forge/i18n";
import { useState } from "react";
import { Modal } from "../ui/Modal.tsx";
import { PWA_MESSAGES, pwaLocale, type PwaMessages } from "./messages.ts";
import { useInstall } from "./runtime.ts";
import "./pwa.css";

interface Props {
  /** Defaults to `<html lang>` (which the app keeps in sync with its setting). */
  locale?: Locale;
}

function ShareIcon() {
  return (
    <svg className="pwa-share-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3v12M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"
      />
    </svg>
  );
}

/** Step-by-step "Share → Add to Home Screen" for iOS Safari, which has no install prompt. */
export function IosInstallSheet({ locale, onClose }: Props & { onClose: () => void }) {
  const t = PWA_MESSAGES[locale ?? pwaLocale()];
  const [before, after] = t.iosStep1.split("{icon}");
  return (
    <Modal title={t.iosTitle} onClose={onClose} sheet closeLabel={t.close}>
      <ol className="pwa-steps">
        <li>
          {before}
          <ShareIcon />
          {after}
        </li>
        <li>{t.iosStep2}</li>
        <li>{t.iosStep3}</li>
      </ol>
      <p className="muted small">{t.iosNote}</p>
      <button type="button" className="btn primary block" onClick={onClose}>
        {t.gotIt}
      </button>
    </Modal>
  );
}

function useInstallAction(t: PwaMessages) {
  const info = useInstall();
  const [iosOpen, setIosOpen] = useState(false);
  const label = info.mode === "ios" ? t.iosHow : t.install;
  const run = () => (info.mode === "ios" ? setIosOpen(true) : void info.install());
  return { info, iosOpen, setIosOpen, label, run };
}

/**
 * One-time, dismissible "Install COLD FORGE" card. Renders nothing when the app is installed,
 * in the native shells, when the browser can't install, or once the user said "Not now".
 */
export function InstallBanner({ locale }: Props) {
  const t = PWA_MESSAGES[locale ?? pwaLocale()];
  const { info, iosOpen, setIosOpen, label, run } = useInstallAction(t);
  if (iosOpen) return <IosInstallSheet locale={locale} onClose={() => setIosOpen(false)} />;
  if (!info.mode || info.dismissed) return null;
  return (
    <section className="pwa-install" aria-label={t.installTitle}>
      <img className="pwa-install-icon" src="./icons/icon-192.png" alt="" width="44" height="44" />
      <div className="pwa-install-copy">
        <p className="pwa-install-title">{t.installTitle}</p>
        <p className="muted small">{t.installBody}</p>
      </div>
      <div className="pwa-install-actions">
        <button type="button" className="btn small ghost" onClick={info.dismiss}>
          {t.notNow}
        </button>
        <button type="button" className="btn small primary" onClick={run}>
          {label}
        </button>
      </div>
    </section>
  );
}

/** Plain "Install app" button (e.g. for Settings). Ignores the banner dismissal; hidden when not installable. */
export function InstallAppButton({ locale, className = "btn secondary block" }: Props & { className?: string }) {
  const t = PWA_MESSAGES[locale ?? pwaLocale()];
  const { info, iosOpen, setIosOpen, label, run } = useInstallAction(t);
  if (!info.mode) return null;
  return (
    <>
      <button type="button" className={className} onClick={run}>
        📲 {label}
      </button>
      {iosOpen && <IosInstallSheet locale={locale} onClose={() => setIosOpen(false)} />}
    </>
  );
}
