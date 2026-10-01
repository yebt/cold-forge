import { useRef, useState } from "react";
import { formatShortDate } from "../i18n/index.ts";
import { arcTitle } from "../lib/derive.ts";
import { prepareImport, readImportFile, type ImportError, type ImportSummary } from "../lib/importData.ts";
import type { AppData } from "../lib/model.ts";
import { useSync } from "../sync/useSync.ts";
import { useApp } from "../state.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Modal } from "../ui/Modal.tsx";

/**
 * "Import data": a hidden file input (works in the Capacitor webview too), strict validation in
 * `readImportFile`, then a preview + confirmation before anything on the device is replaced.
 */
export function ImportData({ onDone }: { onDone: (message: string) => void }) {
  const { t, update } = useApp();
  const im = t.ui.importer;
  const signedIn = useSync().account !== null;
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ data: AppData; summary: ImportSummary } | null>(null);
  const [error, setError] = useState<ImportError | null>(null);

  const errorText: Record<ImportError, string> = {
    too_large: im.errTooLarge,
    not_json: im.errNotJson,
    wrong_format: im.errWrongFormat,
    invalid: im.errInvalid,
  };

  const onPick = async (file: File | undefined) => {
    if (input.current) input.current.value = ""; // picking the same file again still fires
    if (!file) return;
    setError(null);
    const r = await readImportFile(file);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setPending({ data: r.data, summary: r.summary });
  };

  const confirm = () => {
    if (!pending) return;
    const imported = pending.data;
    update((current, now) => prepareImport(current, imported, now));
    setPending(null);
    onDone(im.done);
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => void onPick(e.target.files?.[0])}
        data-testid="import-input"
      />
      <button type="button" className="btn secondary block" onClick={() => input.current?.click()}>
        <Icon name="upload" size={18} />
        {im.button}
      </button>
      {error && (
        <p className="note warn" role="alert">
          {errorText[error]}
        </p>
      )}
      {pending && (
        <Modal title={im.title} onClose={() => setPending(null)} closeLabel={t.ui.common.close}>
          <p className="muted small">{im.preview}</p>
          <div className="arc-box">
            <strong>{arcTitle(pending.summary, t.m)}</strong>
            <span className="muted small">
              {formatShortDate(pending.summary.startDate, t.locale)} → {formatShortDate(pending.summary.endDate, t.locale)}
            </span>
            <span className="muted small">{t.ui.conflict.summary(pending.summary.habits, pending.summary.checkIns)}</span>
          </div>
          <p className="note warn">{signedIn ? im.replaceSynced : im.replace}</p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setPending(null)}>
              {t.ui.common.cancel}
            </button>
            <button className="btn danger" onClick={confirm}>
              {im.confirm}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
