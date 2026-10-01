import { useState } from "react";
import { formatShortDate } from "../i18n/index.ts";
import { arcTitle } from "../lib/derive.ts";
import { summarize } from "../lib/importData.ts";
import type { ArcSummary } from "../lib/sync/conflict.ts";
import { syncEngine } from "../sync/runtime.ts";
import { useApp } from "../state.tsx";
import { Modal } from "../ui/Modal.tsx";

/** First sign-in found a different arc on the account: the user picks which one stays current. */
export function ConflictModal({
  conflict,
  onLater,
}: {
  conflict: { serverArcId: string; server: ArcSummary | null };
  onLater: () => void;
}) {
  const { data, t } = useApp();
  const c = t.ui.conflict;
  const [busy, setBusy] = useState(false);
  const local = summarize(data);

  const choose = async (choice: "device" | "account") => {
    setBusy(true);
    try {
      await syncEngine.resolveConflict(choice);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={c.title} onClose={onLater} closeLabel={t.ui.common.close}>
      <p className="modal-text">{c.body}</p>
      <div className="arc-compare">
        <ArcBox label={c.device} summary={local} />
        {conflict.server && <ArcBox label={c.account} summary={conflict.server} />}
      </div>
      <div className="stack">
        <button className="btn primary block" disabled={busy} onClick={() => void choose("device")}>
          {c.keepDevice}
        </button>
        <button className="btn secondary block" disabled={busy} onClick={() => void choose("account")}>
          {c.useAccount}
        </button>
        <p className="muted small center">{c.note}</p>
        <button className="btn ghost block" onClick={onLater}>
          {c.later}
        </button>
      </div>
    </Modal>
  );

}

function ArcBox({ label, summary }: { label: string; summary: ArcSummary }) {
  const { t } = useApp();
  return (
    <div className="arc-box">
      <span className="eyebrow">{label}</span>
      <strong>{arcTitle(summary, t.m)}</strong>
      <span className="muted small">
        {formatShortDate(summary.startDate, t.locale)} → {formatShortDate(summary.endDate, t.locale)}
      </span>
      <span className="muted small">{t.ui.conflict.summary(summary.habits, summary.checkIns)}</span>
    </div>
  );
}
