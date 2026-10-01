import { useEffect, useState } from "react";
import { syncAvailable } from "../firebase/config.ts";
import { formatAgo } from "../i18n/index.ts";
import type { SyncSnapshot } from "../lib/sync/engine.ts";
import type { SyncError } from "../lib/sync/errors.ts";
import { syncEngine } from "../sync/runtime.ts";
import { useSync } from "../sync/useSync.ts";
import { useApp } from "../state.tsx";
import { Modal } from "../ui/Modal.tsx";

/** Ticks every `ms` so relative times stay fresh. */
function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function AccountSection() {
  const sync = useSync();
  const { t } = useApp();
  const a = t.ui.account;
  return (
    <section className="card group account" aria-labelledby="account-title">
      <h2 id="account-title">{a.title}</h2>
      {sync.account ? <SignedIn sync={sync} /> : <SignedOut />}
    </section>
  );
}

function useErrorText() {
  const a = useApp().t.ui.account;
  return (e: SyncError): string | null => {
    switch (e.kind) {
      case "cancelled":
      case "redirecting":
        return null; // the user closed the popup / the page is navigating to Google
      case "network":
        return a.errNetwork;
      case "rate_limited":
        return a.errRateLimited;
      case "not_configured":
        return a.notAvailable;
      default:
        return a.errGeneric;
    }
  };
}

/** The official multicolor "G" (inline, no external image). */
function GoogleMark() {
  return (
    <svg className="google-mark" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.9 6.2C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z" />
      <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.4 0 20.1 0 24s1 7.6 2.6 10.8l7.9-6.2z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.8-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

function SignedOut() {
  const { t } = useApp();
  const a = t.ui.account;
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const available = syncAvailable();

  // Sign-in is always user-initiated: there is no link or URL that signs this device in.
  const onSignIn = async () => {
    setBusy(true);
    setError(null);
    const r = await syncEngine.signIn();
    setBusy(false);
    if (!r.ok) setError(errorText(r.error));
  };

  return (
    <>
      <p className="account-pitch">{a.pitch}</p>
      <p className="muted small">{a.optional}</p>
      <button className="btn google block" disabled={!available || busy} onClick={() => void onSignIn()}>
        <GoogleMark />
        {busy ? a.signingIn : a.google}
      </button>
      {!available && <p className="note">{a.notAvailable}</p>}
      {error && (
        <p className="note warn" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function statusText(sync: SyncSnapshot, a: ReturnType<typeof useApp>["t"]["ui"]["account"], ago: string | null): string {
  switch (sync.status) {
    case "syncing":
      return a.syncing;
    case "offline":
      return a.offline;
    case "error":
      return a.syncError;
    case "rateLimited":
      return a.rateLimited;
    case "rejected":
      return a.rejected;
    case "blocked":
      return a.blocked;
    case "conflict":
      return a.conflictStatus;
    default:
      return ago ? a.synced(ago) : a.never;
  }
}

type DeleteStep = null | "first" | "second";

function SignedIn({ sync }: { sync: SyncSnapshot }) {
  const { t, reset, showConflict } = useApp();
  const a = t.ui.account;
  const now = useNow(30_000);
  const [step, setStep] = useState<DeleteStep>(null);
  const [confirmErase, setConfirmErase] = useState(false);
  const [eraseLocal, setEraseLocal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ago = sync.lastSyncedAt ? formatAgo(sync.lastSyncedAt, now, t.locale, a.justNow) : null;
  const tone = sync.status === "idle" || sync.status === "syncing" ? "ok" : sync.status === "offline" ? "muted" : "warn";

  /** Shared devices: sign out, then erase everything this device stores (data, history, reminders). */
  const onSignOutErase = async () => {
    setBusy(true);
    await syncEngine.signOut();
    await reset();
    setBusy(false);
    setConfirmErase(false);
  };

  /**
   * Google re-auth (popup), then the account itself; the server erases the synced data within a
   * few minutes (onUserDeleted). Local data stays unless chosen.
   */
  const onDelete = async () => {
    setBusy(true);
    setError(null);
    const r = await syncEngine.deleteAccount();
    setBusy(false);
    setStep(null);
    if (!r.ok) {
      setError(r.error.kind === "cancelled" ? a.deleteCancelled : a.deleteFailed);
      return;
    }
    if (eraseLocal) await reset();
  };

  return (
    <>
      <div className="account-who">
        <span className="muted small">{a.signedInAs}</span>
        <strong className="account-email">{sync.account?.email}</strong>
      </div>
      <p className={`sync-status ${tone}`} role="status" aria-live="polite">
        <span className="dot" aria-hidden="true" />
        {statusText(sync, a, ago)}
        {sync.live && sync.status === "idle" && <span className="live-pill">{a.live}</span>}
      </p>
      {sync.status === "conflict" ? (
        <button className="btn primary block" onClick={showConflict}>
          {a.chooseArc}
        </button>
      ) : (
        <button
          className="btn secondary block"
          disabled={sync.status === "syncing" || sync.status === "rateLimited"}
          onClick={() => void syncEngine.requestSync("manual")}
        >
          🔄 {a.syncNow}
        </button>
      )}
      <button className="btn ghost block" onClick={() => void syncEngine.signOut()}>
        {a.signOut}
      </button>
      <p className="muted small center">{a.signOutNote}</p>
      <button className="btn ghost block" onClick={() => setConfirmErase(true)}>
        {a.signOutErase}
      </button>
      {error && (
        <p className="note warn" role="alert">
          {error}
        </p>
      )}
      <button className="btn danger block" onClick={() => setStep("first")}>
        {a.deleteAccount}
      </button>

      {confirmErase && (
        <Modal title={a.signOutEraseTitle} onClose={() => !busy && setConfirmErase(false)} closeLabel={t.ui.common.close}>
          <p className="modal-text">{a.signOutEraseBody}</p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setConfirmErase(false)} disabled={busy}>
              {t.ui.common.cancel}
            </button>
            <button className="btn danger" onClick={() => void onSignOutErase()} disabled={busy}>
              {a.signOutEraseYes}
            </button>
          </div>
        </Modal>
      )}
      {step === "first" && (
        <Modal title={a.deleteTitle} onClose={() => setStep(null)} closeLabel={t.ui.common.close}>
          <p className="modal-text">{a.deleteBody}</p>
          <label className="check-row">
            <input type="checkbox" checked={eraseLocal} onChange={(e) => setEraseLocal(e.target.checked)} />
            <span>{a.deleteAlsoLocal}</span>
          </label>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setStep(null)}>
              {t.ui.common.cancel}
            </button>
            <button className="btn danger" onClick={() => setStep("second")}>
              {a.deleteContinue}
            </button>
          </div>
        </Modal>
      )}
      {step === "second" && (
        <Modal title={a.deleteConfirmTitle} onClose={() => !busy && setStep(null)} closeLabel={t.ui.common.close}>
          <p className="modal-text">{eraseLocal ? a.deleteConfirmBodyLocal : a.deleteConfirmBody}</p>
          <p className="muted small">{a.deleteGoogleNote}</p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setStep(null)} disabled={busy}>
              {t.ui.common.cancel}
            </button>
            <button className="btn danger" onClick={() => void onDelete()} disabled={busy}>
              {a.deleteYes}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
