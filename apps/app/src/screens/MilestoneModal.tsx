import { useEffect } from "react";
import { hapticSuccess } from "../platform/feedback.ts";
import { useApp } from "../state.tsx";
import { Icon } from "../ui/Icon.tsx";
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
    <Modal title={ui.milestone.title} onClose={onClose} closeLabel={ui.common.close} className="milestone-modal">
      <div className="milestone-body">
        <span className="milestone-day" aria-hidden="true">
          {day}
        </span>
        <strong className="milestone-name">{m.milestones[day]}</strong>
        <span className="label">{ui.progress.locked(day)}</span>
        <p className="secondary-text">{ui.milestone.body(day)}</p>
        <button type="button" className="btn primary block" onClick={onShare}>
          <Icon name="share" size={18} strokeWidth={2.2} />
          {ui.milestone.share}
        </button>
        <button type="button" className="btn ghost block" onClick={onClose}>
          {ui.milestone.later}
        </button>
      </div>
    </Modal>
  );
}
