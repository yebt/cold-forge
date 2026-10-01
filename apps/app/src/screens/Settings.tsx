import { LOCALES, LOCALE_NAMES } from "@cold-forge/i18n";
import { useEffect, useState, type FormEvent } from "react";
import { habitName } from "../lib/derive.ts";
import {
  TEXT_LIMITS,
  activeHabits,
  addHabit,
  deleteHabit,
  moveHabit,
  updateHabit,
  updateSettings,
  updateWhy,
  type StoredHabit,
} from "../lib/model.ts";
import { exportJSON } from "../lib/repository.ts";
import { checkEmoji, checkField, type FieldProblem } from "../lib/fields.ts";
import { EmojiField } from "../ui/EmojiField.tsx";
import { FieldHint } from "../ui/FieldHint.tsx";
import { remindersSupported, requestReminderPermission, type ReminderPermission } from "../platform/notifications.ts";
import { shareFile } from "../platform/share.ts";
import { InstallAppButton } from "../pwa/index.ts";
import { useSync } from "../sync/useSync.ts";
import { useApp } from "../state.tsx";
import { AccountSection } from "./AccountSection.tsx";
import { ImportData } from "./ImportData.tsx";
import { Modal } from "../ui/Modal.tsx";
import { Toggle } from "../ui/Toggle.tsx";
import { HabitIcon, Icon } from "../ui/Icon.tsx";

const APP_VERSION = "0.1.0";

export function Settings() {
  const { data, t, update, reset } = useApp();
  const { ui, m } = t;
  const s = ui.settings;
  const [permission, setPermission] = useState<ReminderPermission | null>(
    remindersSupported() ? null : "unsupported",
  );
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<StoredHabit | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newEmoji, setNewEmoji] = useState("🔥");
  const [addTried, setAddTried] = useState(false);
  const [nameProblem, setNameProblem] = useState<FieldProblem | null>(null);
  const [whyProblem, setWhyProblem] = useState<FieldProblem | null>(null);
  const f = ui.fields;
  const emojiLabels = { choose: f.chooseEmoji, type: f.typeEmoji, invalid: f.emojiInvalid };
  const newNameProblem = checkField("name", newName);
  const habits = activeHabits(data);
  const signedIn = useSync().account !== null;
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  const toggleReminders = async (on: boolean) => {
    if (on) {
      const p = await requestReminderPermission();
      setPermission(p);
      if (p === "denied") return;
    }
    update((d, now) => updateSettings(d, { reminderEnabled: on }, now));
  };

  const onAdd = (e: FormEvent) => {
    e.preventDefault();
    setAddTried(true);
    if (newNameProblem || !checkEmoji(newEmoji)) return;
    update((d, now) => addHabit(d, { name: newName, emoji: newEmoji }, now));
    setNewName("");
    setNewEmoji("🔥");
    setAddTried(false);
  };

  const onExport = async () => {
    const blob = new Blob([exportJSON(data)], { type: "application/json" });
    try {
      await shareFile(blob, `cold-forge-${data.arc.startDate}.json`);
    } catch (e) {
      console.warn("[export]", e);
    }
  };

  return (
    <div className="settings">
      <header className="screen-head">
        <h1 className="screen-title">{s.title}</h1>
      </header>

      <section className="card group">
        <h2>{s.general}</h2>
        <div className="row">
          <span id="settings-lang">{s.language}</span>
          <div className="seg" role="radiogroup" aria-labelledby="settings-lang">
            {LOCALES.map((l) => (
              <button
                key={l}
                role="radio"
                aria-checked={data.settings.locale === l}
                type="button"
                className={`seg-btn${data.settings.locale === l ? " on" : ""}`}
                onClick={() => update((d, now) => updateSettings(d, { locale: l }, now))}
                title={LOCALE_NAMES[l]}
                aria-label={LOCALE_NAMES[l]}
                lang={l}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <Toggle label={s.sound} checked={data.settings.sound} onChange={(v) => update((d, now) => updateSettings(d, { sound: v }, now))} />
        <Toggle
          label={s.haptics}
          checked={data.settings.haptics}
          onChange={(v) => update((d, now) => updateSettings(d, { haptics: v }, now))}
        />
      </section>

      <section className="card group">
        <h2>{s.reminders}</h2>
        <Toggle label={s.reminders} checked={data.settings.reminderEnabled} onChange={(v) => void toggleReminders(v)} />
        {data.settings.reminderEnabled && (
          <label className="row">
            <span>{s.reminderTime}</span>
            <input
              type="time"
              className="time-input"
              value={data.settings.reminderTime}
              onChange={(e) => {
                const v = e.target.value;
                if (/^\d{2}:\d{2}$/.test(v)) update((d, now) => updateSettings(d, { reminderTime: v }, now));
              }}
            />
          </label>
        )}
        {permission === "denied" && <p className="note warn">{s.reminderDenied}</p>}
        {permission === "unsupported" && <p className="note">{s.reminderUnsupported}</p>}
      </section>

      <section className="card group">
        <label className="field">
          <span>{s.displayName}</span>
          <input
            defaultValue={data.settings.displayName}
            placeholder={ui.onboarding.namePlaceholder}
            maxLength={30}
            aria-invalid={nameProblem !== null}
            onChange={() => setNameProblem(null)}
            onBlur={(e) => {
              const v = e.target.value.trim();
              const problem = checkField("displayName", v);
              setNameProblem(problem);
              if (problem) return; // keep what they typed, explain, don't save
              if (v !== data.settings.displayName) update((d, now) => updateSettings(d, { displayName: v }, now));
            }}
          />
        </label>
        <FieldHint problem={nameProblem} field="displayName" f={f} />
        <label className="field">
          <span>{s.why}</span>
          <textarea
            className="why-input"
            defaultValue={data.arc.why}
            placeholder={ui.onboarding.whyPlaceholder}
            maxLength={140}
            rows={2}
            aria-invalid={whyProblem !== null}
            onChange={() => setWhyProblem(null)}
            onBlur={(e) => {
              const problem = checkField("why", e.target.value);
              setWhyProblem(problem);
              if (problem) return;
              if (e.target.value.trim() !== data.arc.why) update((d, now) => updateWhy(d, e.target.value, now));
            }}
          />
        </label>
        <FieldHint problem={whyProblem} field="why" f={f} />
      </section>

      <section className="card group">
        <h2>{s.habits}</h2>
        <ul className="habit-edit-list">
          {habits.map((h, i) =>
            editingId === h.id ? (
              <EditHabitRow
                key={h.id}
                habit={h}
                name={habitName(h, m)}
                saveLabel={ui.common.save}
                cancelLabel={ui.common.cancel}
                f={f}
                onCancel={() => setEditingId(null)}
                onSave={(name, emoji) => {
                  update((d, now) =>
                    updateHabit(d, h.id, { emoji, ...(name !== habitName(h, m) ? { name } : {}) }, now),
                  );
                  setEditingId(null);
                }}
              />
            ) : (
              <li key={h.id} className="habit-edit-row">
                <HabitIcon habit={h} />
                <span className="he-name">{habitName(h, m)}</span>
                <span className="he-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={i === 0}
                    aria-label={`${s.moveUp}: ${habitName(h, m)}`}
                    onClick={() => update((d, now) => moveHabit(d, h.id, -1, now))}
                  >
                    <Icon name="up" size={18} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={i === habits.length - 1}
                    aria-label={`${s.moveDown}: ${habitName(h, m)}`}
                    onClick={() => update((d, now) => moveHabit(d, h.id, 1, now))}
                  >
                    <Icon name="down" size={18} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`${s.edit}: ${habitName(h, m)}`} onClick={() => setEditingId(h.id)}>
                    <Icon name="edit" size={18} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    aria-label={`${ui.common.delete}: ${habitName(h, m)}`}
                    onClick={() => setConfirmDelete(h)}
                  >
                    <Icon name="trash" size={18} />
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
        <form className="add-habit" onSubmit={onAdd}>
          <EmojiField value={newEmoji} onChange={setNewEmoji} labels={emojiLabels} />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={s.addHabit}
            aria-label={ui.onboarding.customName}
            aria-invalid={newName !== "" && newNameProblem !== null}
            maxLength={TEXT_LIMITS.name}
          />
          <button type="submit" className="btn secondary" disabled={!newName.trim()}>
            {ui.common.add}
          </button>
        </form>
        {/* Only nag about blank after an attempt; hidden/unsupported characters show as you type. */}
        <FieldHint
          problem={newNameProblem === "blank" ? (addTried && newName !== "" ? "blank" : null) : newNameProblem}
          field="name"
          f={f}
        />
      </section>

      <AccountSection />

      <section className="card group">
        <h2>{s.data}</h2>
        <button type="button" className="btn secondary block" onClick={onExport}>
          <Icon name="download" size={18} />
          {s.export}
        </button>
        <ImportData onDone={setToast} />
        <InstallAppButton locale={t.locale} />
        <button type="button" className="btn danger block" onClick={() => setConfirmReset(true)}>
          {s.reset}
        </button>
      </section>

      <footer className="settings-foot">
        <p className="muted small">
          <Icon name="lock" size={14} />
          {signedIn ? ui.account.syncedNote : s.offline}
        </p>
        <p className="label-num">{s.version(APP_VERSION)}</p>
      </footer>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {confirmReset && (
        <Modal title={s.reset} onClose={() => setConfirmReset(false)} closeLabel={ui.common.close}>
          <p className="modal-text">{s.resetConfirm}</p>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setConfirmReset(false)}>
              {ui.common.cancel}
            </button>
            <button type="button" className="btn danger" onClick={() => void reset()}>
              {s.resetYes}
            </button>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal title={ui.common.delete} onClose={() => setConfirmDelete(null)} closeLabel={ui.common.close}>
          <p className="modal-text">{s.deleteHabitConfirm(habitName(confirmDelete, m))}</p>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setConfirmDelete(null)}>
              {ui.common.cancel}
            </button>
            <button
              className="btn danger"
              onClick={() => {
                update((d, now) => deleteHabit(d, confirmDelete.id, now));
                setConfirmDelete(null);
              }}
            >
              {ui.common.delete}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function EditHabitRow(props: {
  habit: StoredHabit;
  name: string;
  saveLabel: string;
  cancelLabel: string;
  f: ReturnType<typeof useApp>["t"]["ui"]["fields"];
  onSave: (name: string, emoji: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(props.name);
  const [emoji, setEmoji] = useState(checkEmoji(props.habit.emoji) ? props.habit.emoji : "🔥");
  const problem = checkField("name", name);
  const { f } = props;
  return (
    <li className="habit-edit-row editing">
      <form
        className="add-habit"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem && checkEmoji(emoji)) props.onSave(name.trim(), emoji);
        }}
      >
        <EmojiField value={emoji} onChange={setEmoji} labels={{ choose: f.chooseEmoji, type: f.typeEmoji, invalid: f.emojiInvalid }} />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={TEXT_LIMITS.name}
          aria-invalid={problem !== null}
          autoFocus
        />
        <button type="submit" className="btn primary" disabled={problem !== null}>
          {props.saveLabel}
        </button>
        <button type="button" className="btn ghost" onClick={props.onCancel}>
          {props.cancelLabel}
        </button>
      </form>
      <FieldHint problem={problem} field="name" f={f} />
    </li>
  );
}
