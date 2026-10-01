import { useEffect } from "react";
import { hapticSuccess } from "../platform/feedback.ts";
import { useApp } from "../state.tsx";
import { Modal } from "../ui/Modal.tsx";
import { celebrate } from "../ui/sparks.ts";

export function MilestoneModal({ day, onClose, onShare }: { day: number; onClose: () => void; onShare: () => void }) {
  const { t, data } = useApp();
  const { ui, m } = t;
  useEffect(() => {
    celebrate();
    if (data.settings.haptics) void hapticSuccess();
  }, []);
  return (
    <Modal title={ui.milestone.title} onClose={onClose} closeLabel={ui.common.close}>
      <div className="milestone-body">
        <span className="milestone-badge">🏅</span>
        <strong className="milestone-day">{ui.progress.locked(day)}</strong>
        <span className="milestone-name">{m.milestones[day]}</span>
        <p className="muted">{ui.milestone.body(day)}</p>
        <button
          className="btn primary block"
          onClick={onShare}
        >
          📣 {ui.milestone.share}
        </button>
        <button className="btn ghost block" onClick={onClose}>
          {ui.milestone.later}
        </button>
      </div>
    </Modal>
  );
}
