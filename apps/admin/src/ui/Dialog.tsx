import { useEffect, useRef, type ReactNode } from "react";
import { copy } from "../copy.ts";

interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  tone?: "default" | "danger";
  busy?: boolean;
  canConfirm?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Native modal <dialog>: focus trap, Esc and inert background for free. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  tone = "default",
  busy = false,
  canConfirm = true,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <form
        method="dialog"
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (canConfirm && !busy) onConfirm();
        }}
      >
        <h3 id="dialog-title">{title}</h3>
        <div className="dialog-content">{children}</div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            {copy.dialogs.cancel}
          </button>
          <button type="submit" className={`btn ${tone === "danger" ? "btn-danger" : "btn-primary"}`} disabled={!canConfirm || busy}>
            {busy ? <span className="spinner" aria-hidden /> : null}
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
