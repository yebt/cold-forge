import { useState } from "react";
import type { AuthState, Backend } from "../backend/types.ts";
import { copy } from "../copy.ts";
import { Logo } from "../ui/bits.tsx";

type SignedOut = Extract<AuthState, { status: "signed-out" }>;

export function SignIn({ backend, state }: { backend: Backend; state: SignedOut }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notice =
    state.notice === "denied"
      ? copy.signIn.denied(state.email)
      : state.notice === "expired"
        ? copy.signIn.expired
        : state.notice === "idle"
          ? copy.signIn.idle
          : state.notice === "error"
            ? copy.signIn.error
            : null;

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      await backend.signIn();
    } catch (e) {
      const code = (e as { code?: string })?.code ?? "";
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") setError(null);
      else if (code === "auth/popup-blocked") setError(copy.signIn.popupBlocked);
      else setError(copy.signIn.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="signin">
      <div className="signin-card">
        <div className="signin-brand">
          <Logo />
          <div>
            <div className="brand">{copy.brand}</div>
            <div className="eyebrow">{copy.product}</div>
          </div>
        </div>
        <h1>{state.notice === "denied" ? copy.signIn.deniedTitle : copy.signIn.title}</h1>
        <p className="muted">{copy.signIn.body}</p>
        {(notice || error) && (
          <p className={`notice ${state.notice === "denied" || error ? "notice-danger" : ""}`} role="alert">
            {error ?? notice}
          </p>
        )}
        <button type="button" className="btn btn-primary btn-lg" onClick={signIn} disabled={busy}>
          {busy ? <span className="spinner" aria-hidden /> : <GoogleMark />}
          {busy ? copy.signIn.working : copy.signIn.button}
        </button>
        <p className="small muted">{copy.signIn.footer}</p>
      </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
