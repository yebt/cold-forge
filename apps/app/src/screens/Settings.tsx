import { LOCALES, LOCALE_NAMES } from "@cold-forge/i18n";
import { useState, type FormEvent } from "react";
import { habitName } from "../lib/derive.ts";
import {
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
import { firstGrapheme } from "../lib/text.ts";
import { remindersSupported, requestReminderPermission, type ReminderPermission } from "../platform/notifications.ts";
import { shareFile } from "../platform/share.ts";
import { useApp } from "../state.tsx";
import { Modal } from "../ui/Modal.tsx";
import { Toggle } from "../ui/Toggle.tsx";

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
  const [newEmoji, setNewEmoji] = useState("");
  const habits = activeHabits(data);

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
    if (!newName.trim()) return;
    update((d, now) => addHabit(d, { name: newName, emoji: firstGrapheme(newEmoji) || "🔥" }, now));
    setNewName("");
    setNewEmoji("");
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
      <h1 className="screen-title">{s.title}</h1>

      <section className="card group">
        <h2>{s.general}</h2>
        <div className="row">
          <span>{s.language}</span>
          <div className="pills-row" role="radiogroup" aria-label={s.language}>
            {LOCALES.map((l) => (
              <button
                key={l}
                role="radio"
                aria-checked={data.settings.locale === l}
                className={`pill small${data.settings.locale === l ? " on" : ""}`}
                onClick={() => update((d, now) => updateSettings(d, { locale: l }, now))}
                title={LOCALE_NAMES[l]}
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
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== data.settings.displayName) update((d, now) => updateSettings(d, { displayName: v }, now));
            }}
          />
        </label>
        <label className="field">
          <span>{s.why}</span>
          <textarea
            className="why-input"
            defaultValue={data.arc.why}
            placeholder={ui.onboarding.whyPlaceholder}
            maxLength={140}
            rows={2}
            onBlur={(e) => {
              if (e.target.value.trim() !== data.arc.why) update((d, now) => updateWhy(d, e.target.value, now));
            }}
          />
        </label>
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
                <span className="he-emoji" aria-hidden="true">
                  {h.emoji}
                </span>
                <span className="he-name">{habitName(h, m)}</span>
                <span className="he-actions">
                  <button className="icon-btn" disabled={i === 0} aria-label={s.moveUp} onClick={() => update((d, now) => moveHabit(d, h.id, -1, now))}>
                    ↑
                  </button>
                  <button
                    className="icon-btn"
                    disabled={i === habits.length - 1}
                    aria-label={s.moveDown}
                    onClick={() => update((d, now) => moveHabit(d, h.id, 1, now))}
                  >
                    ↓
                  </button>
                  <button className="icon-btn" aria-label={s.edit} onClick={() => setEditingId(h.id)}>
                    ✎
                  </button>
                  <button className="icon-btn danger" aria-label={ui.common.delete} onClick={() => setConfirmDelete(h)}>
                    🗑
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
        <form className="add-habit" onSubmit={onAdd}>
          <input
            className="emoji-input"
            value={newEmoji}
            onChange={(e) => setNewEmoji(e.target.value)}
            placeholder="🔥"
            aria-label={ui.onboarding.customEmoji}
          />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={s.addHabit}
            aria-label={ui.onboarding.customName}
            maxLength={40}
          />
          <button type="submit" className="btn secondary" disabled={!newName.trim()}>
            {ui.common.add}
          </button>
        </form>
      </section>

      <section className="card group">
        <h2>{s.data}</h2>
        <button className="btn secondary block" onClick={onExport}>
          ⬇️ {s.export}
        </button>
        <button className="btn danger block" onClick={() => setConfirmReset(true)}>
          {s.reset}
        </button>
        <p className="muted small center">
          🔒 {s.offline}
          <br />
          {s.version(APP_VERSION)}
        </p>
      </section>

      {confirmReset && (
        <Modal title={s.reset} onClose={() => setConfirmReset(false)} closeLabel={ui.common.close}>
          <p className="modal-text">{s.resetConfirm}</p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setConfirmReset(false)}>
              {ui.common.cancel}
            </button>
            <button className="btn danger" onClick={() => void reset()}>
              {s.resetYes}
            </button>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal title={ui.common.delete} onClose={() => setConfirmDelete(null)} closeLabel={ui.common.close}>
          <p className="modal-text">{s.deleteHabitConfirm(habitName(confirmDelete, m))}</p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setConfirmDelete(null)}>
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
  onSave: (name: string, emoji: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(props.name);
  const [emoji, setEmoji] = useState(props.habit.emoji);
  return (
    <li className="habit-edit-row editing">
      <form
        className="add-habit"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) props.onSave(name.trim(), firstGrapheme(emoji) || props.habit.emoji);
        }}
      >
        <input className="emoji-input" value={emoji} onChange={(e) => setEmoji(e.target.value)} aria-label="Emoji" />
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus />
        <button type="submit" className="btn primary small">
          {props.saveLabel}
        </button>
        <button type="button" className="btn ghost small" onClick={props.onCancel}>
          {props.cancelLabel}
        </button>
      </form>
    </li>
  );
}
