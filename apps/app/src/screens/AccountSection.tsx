import { normalizeEmail, type SessionResponse } from "@cold-forge/sync";
import { useEffect, useState, type FormEvent } from "react";
import { formatAgo } from "../i18n/index.ts";
import type { ApiError } from "../lib/sync/api.ts";
import type { SyncSnapshot } from "../lib/sync/engine.ts";
import { syncEngine } from "../sync/runtime.ts";
import { useSync } from "../sync/useSync.ts";
import { useApp } from "../state.tsx";
import { Modal } from "../ui/Modal.tsx";

/** At least 30 s per the API; 60 s keeps inboxes calm. */
export const RESEND_COOLDOWN_S = 60;

type Step = { kind: "intro" } | { kind: "email" } | { kind: "code"; email: string; requestId: string };

/** Ticks every `ms` so relative times and countdowns stay fresh. */
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
      {sync.account ? <SignedIn sync={sync} /> : <SignInFlow />}
    </section>
  );
}

function useErrorText() {
  const a = useApp().t.ui.account;
  return (e: ApiError): string => {
    switch (e.kind) {
      case "invalid_email":
        return a.errInvalidEmail;
      case "invalid_or_expired":
        return a.errInvalidCode;
      case "network":
        return a.errNetwork;
      case "rate_limited":
        return a.errRateLimited;
      case "insecure":
        return a.errInsecure;
      default:
        return a.errGeneric;
    }
  };
}

/** Asks the API to email a code. Returns the request id, or an error message. */
async function requestCode(
  email: string,
  locale: Parameters<typeof syncEngine.api.requestMagicLink>[1],
): Promise<{ ok: true; requestId: string } | { ok: false; error: ApiError }> {
  // Lets the emailed link for this same address sign in without the extra confirmation.
  syncEngine.noteCodeRequested(email);
  const r = await syncEngine.api.requestMagicLink(email, locale);
  return r.ok ? { ok: true, requestId: r.value.requestId } : r;
}

/** The 6-digit code step: numeric one-time-code input, auto-submit, resend with cooldown. */
function CodeEntry({
  email,
  requestId: initialRequestId,
  title,
  body,
  submitLabel,
  onSession,
  secondary,
}: {
  email: string;
  requestId: string;
  title: string;
  body: string;
  submitLabel: string;
  onSession: (s: SessionResponse) => Promise<void>;
  secondary?: { label: string; onClick: () => void };
}) {
  const { t } = useApp();
  const a = t.ui.account;
  const errorText = useErrorText();
  const [requestId, setRequestId] = useState(initialRequestId);
  const [sentAt, setSentAt] = useState(Date.now);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(1000);
  // `now` ticks once a second and may lag `sentAt` by a moment: clamp to [0, cooldown].
  const wait = Math.min(RESEND_COOLDOWN_S, Math.max(0, RESEND_COOLDOWN_S - Math.floor((now - sentAt) / 1000)));

  const verify = async (value: string) => {
    if (!/^\d{6}$/.test(value) || busy) return;
    setBusy(true);
    setError(null);
    const r = await syncEngine.api.verify({ requestId, code: value });
    if (!r.ok) {
      setBusy(false);
      setError(errorText(r.error));
      return;
    }
    await onSession(r.value);
    setBusy(false);
  };

  const resend = async () => {
    setBusy(true);
    setError(null);
    const r = await requestCode(email, t.locale);
    setBusy(false);
    if (!r.ok) {
      setError(errorText(r.error));
      return;
    }
    setRequestId(r.requestId);
    setSentAt(Date.now());
    setCode("");
  };

  return (
    <form
      className="account-form"
      onSubmit={(e) => {
        e.preventDefault();
        void verify(code);
      }}
    >
      <p className="account-step-title">📬 {title}</p>
      <p className="muted small account-sent">{body}</p>
      <label className="field">
        <span>{a.codeLabel}</span>
        <input
          className="code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          placeholder="••••••"
          value={code}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
            setCode(digits);
            if (digits.length === 6) void verify(digits);
          }}
          autoFocus
        />
      </label>
      {error && (
        <p className="note warn" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn primary block" disabled={busy || code.length !== 6}>
        {submitLabel}
      </button>
      <div className="account-actions">
        {secondary ? (
          <button type="button" className="btn ghost small" onClick={secondary.onClick}>
            {secondary.label}
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="btn ghost small" disabled={busy || wait > 0} onClick={() => void resend()}>
          {wait > 0 ? a.resendIn(wait) : a.resend}
        </button>
      </div>
    </form>
  );
}

function SignInFlow() {
  const { t } = useApp();
  const a = t.ui.account;
  const errorText = useErrorText();
  const [step, setStep] = useState<Step>({ kind: "intro" });
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const normalized = normalizeEmail(email);
    if (!normalized.ok) {
      setError(a.errInvalidEmail);
      return;
    }
    setBusy(true);
    setError(null);
    const r = await requestCode(normalized.value, t.locale);
    setBusy(false);
    if (!r.ok) {
      setError(errorText(r.error));
      return;
    }
    setStep({ kind: "code", email: normalized.value, requestId: r.requestId });
  };

  if (step.kind === "intro") {
    return (
      <>
        <p className="account-pitch">{a.pitch}</p>
        <p className="muted small">{a.optional}</p>
        <button className="btn secondary block" onClick={() => setStep({ kind: "email" })}>
          {a.start}
        </button>
      </>
    );
  }

  if (step.kind === "email") {
    const onSubmit = (e: FormEvent) => {
      e.preventDefault();
      void send();
    };
    return (
      <form className="account-form" onSubmit={onSubmit} noValidate>
        <p className="account-pitch">{a.pitch}</p>
        <label className="field">
          <span>{a.emailLabel}</span>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={254}
            placeholder={a.emailPlaceholder}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </label>
        {error && (
          <p className="note warn" role="alert">
            {error}
          </p>
        )}
        <div className="account-actions">
          <button type="button" className="btn ghost" onClick={() => setStep({ kind: "intro" })}>
            {t.ui.common.back}
          </button>
          <button type="submit" className="btn primary" disabled={busy || !email.trim()}>
            {a.sendCode}
          </button>
        </div>
      </form>
    );
  }

  return (
    <CodeEntry
      key={step.requestId}
      email={step.email}
      requestId={step.requestId}
      title={a.checkInbox}
      body={a.sentTo(step.email)}
      submitLabel={a.verify}
      onSession={(s) => syncEngine.signIn(s)}
      secondary={{ label: a.changeEmail, onClick: () => setStep({ kind: "email" }) }}
    />
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
    case "quota":
      return a.quota;
    case "rejected":
      return a.rejected;
    case "conflict":
      return a.conflictStatus;
    default:
      return ago ? a.synced(ago) : a.never;
  }
}

type DeleteStep = null | { kind: "first" } | { kind: "second" };

function SignedIn({ sync }: { sync: SyncSnapshot }) {
  const { t, reset, showConflict } = useApp();
  const a = t.ui.account;
  const now = useNow(30_000);
  const [step, setStep] = useState<DeleteStep>(null);
  const [eraseLocal, setEraseLocal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ago = sync.lastSyncedAt ? formatAgo(sync.lastSyncedAt, now, t.locale, a.justNow) : null;
  const tone = sync.status === "idle" || sync.status === "syncing" ? "ok" : sync.status === "offline" ? "muted" : "warn";
  const email = sync.account?.email ?? "";

  const onDelete = async () => {
    setBusy(true);
    setError(null);
    const r = await syncEngine.deleteAccount();
    setBusy(false);
    setStep(null);
    if (!r.ok) {
      setError(a.deleteFailed);
      return;
    }
    if (eraseLocal) await reset();
  };

  return (
    <>
      <div className="account-who">
        <span className="muted small">{a.signedInAs}</span>
        <strong className="account-email">{email}</strong>
      </div>
      <p className={`sync-status ${tone}`} role="status" aria-live="polite">
        <span className="dot" aria-hidden="true" />
        {statusText(sync, a, ago)}
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
      {error && (
        <p className="note warn" role="alert">
          {error}
        </p>
      )}
      <button className="btn danger block" onClick={() => setStep({ kind: "first" })}>
        {a.deleteAccount}
      </button>

      {step?.kind === "first" && (
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
            <button className="btn danger" onClick={() => setStep({ kind: "second" })}>
              {a.deleteContinue}
            </button>
          </div>
        </Modal>
      )}
      {step?.kind === "second" && (
        <Modal title={a.deleteConfirmTitle} onClose={() => setStep(null)} closeLabel={t.ui.common.close}>
          <p className="modal-text">{eraseLocal ? a.deleteConfirmBodyLocal : a.deleteConfirmBody}</p>
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
