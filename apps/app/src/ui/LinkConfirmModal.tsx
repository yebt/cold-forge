import type { Locale } from "@cold-forge/i18n";
import { useState } from "react";
import { UI_MESSAGES } from "../i18n/index.ts";
import { syncEngine } from "../sync/runtime.ts";
import { useSync } from "../sync/useSync.ts";
import { Modal } from "./Modal.tsx";

/**
 * Login-CSRF guard: a sign-in link someone else requested must not silently link this device.
 * The user sees which account the link belongs to and has to confirm.
 */
export function LinkConfirmModal({ locale }: { locale: Locale }) {
  const { pendingLink } = useSync();
  const [busy, setBusy] = useState(false);
  if (!pendingLink) return null;
  const a = UI_MESSAGES[locale].account;
  const cancel = () => void syncEngine.cancelLink();
  return (
    <Modal title={a.linkTitle} onClose={cancel} closeLabel={UI_MESSAGES[locale].common.close}>
      <p className="modal-text">{a.linkBody}</p>
      <p className="link-email">{pendingLink.email}</p>
      <div className="stack">
        <button
          className="btn primary block"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await syncEngine.confirmLink();
            setBusy(false);
          }}
        >
          {a.linkYes}
        </button>
        <button className="btn ghost block" onClick={cancel}>
          {a.linkNo}
        </button>
      </div>
    </Modal>
  );
}
