import { useState } from "react";
import { errorMessage, useAdmin } from "../admin.tsx";
import type { UserRowDto } from "../backend/types.ts";
import { copy } from "../copy.ts";
import { confirmMatches, REASON_MAX, reasonValid } from "../format.ts";
import { ConfirmDialog } from "../ui/Dialog.tsx";

export type UserAction = "disable" | "enable" | "delete";

interface Props {
  action: UserAction;
  user: UserRowDto;
  onClose: () => void;
  /** `null` = the account was deleted. */
  onDone: (user: UserRowDto | null) => void;
}

export function UserActionDialog({ action, user, onClose, onDone }: Props) {
  const { run, toast } = useAdmin();
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const who = user.email ?? user.uid;
  const d = copy.dialogs;
  const reasonRequired = action === "disable" || action === "enable";
  const reasonOk = reasonRequired ? reasonValid(reason) : reason.trim() === "" || reasonValid(reason);
  const typedOk = action !== "delete" || confirmMatches(typed, who);

  const meta = {
    disable: { title: d.disableTitle, body: d.disableBody(who), confirm: d.disableConfirm, tone: "danger" as const },
    enable: { title: d.enableTitle, body: d.enableBody(who), confirm: d.enableConfirm, tone: "default" as const },
    delete: { title: d.deleteTitle, body: d.deleteBody, confirm: d.deleteConfirm, tone: "danger" as const },
  }[action];

  async function submit() {
    setBusy(true);
    setError(null);
    const why = reason.trim() || null;
    try {
      if (action === "disable" || action === "enable") {
        const res = await run("adminSetDisabled", { uid: user.uid, disabled: action === "disable", reason: why ?? "" });
        toast(action === "disable" ? copy.toasts.disabled : copy.toasts.enabled);
        onDone(res.user ? { ...res.user, counts: user.counts } : null);
      } else {
        await run("adminDeleteUser", { uid: user.uid, confirm: typed.trim(), reason: why });
        toast(copy.toasts.deleted);
        onDone(null);
      }
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      title={meta.title}
      confirmLabel={meta.confirm}
      tone={meta.tone}
      busy={busy}
      canConfirm={reasonOk && typedOk}
      error={error}
      onCancel={onClose}
      onConfirm={submit}
    >
      <p>{meta.body}</p>
      {action === "delete" && (
        <label className="field">
          <span>{d.deleteTypeLabel(who)}</span>
          <input
            className="input mono"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={who}
            autoFocus
          />
        </label>
      )}
      <label className="field">
        <span>
          {d.reasonLabel}
          {!reasonRequired && <span className="muted"> · optional</span>}
        </span>
        <textarea
          className="input"
          rows={2}
          maxLength={REASON_MAX}
          value={reason}
          onChange={(e) => setReason(e.target.value.replace(/[\r\n]+/g, " "))}
          placeholder={d.reasonPlaceholder}
          autoFocus={action !== "delete"}
        />
        <span className="hint">{d.reasonHint}</span>
      </label>
    </ConfirmDialog>
  );
}
