import type { ISODate } from "@cold-forge/core";
import { useState } from "react";
import { formatShortDate } from "../i18n/index.ts";
import { heatmap, habitName } from "../lib/derive.ts";
import { milestoneStates } from "../lib/milestones.ts";
import { activeHabits, isDone, setCheckIn } from "../lib/model.ts";
import { useApp } from "../state.tsx";
import { Modal } from "../ui/Modal.tsx";
import { RankCard } from "../ui/RankCard.tsx";

export function Progress() {
  const { data, today, t, derived, update } = useApp();
  const { ui, m, locale } = t;
  const { stats } = derived;
  const [editing, setEditing] = useState<{ date: ISODate; day: number } | null>(null);
  const cells = heatmap(data, today);
  const p = ui.progress;

  return (
    <div className="progress">
      <h1 className="screen-title">{p.title}</h1>

      <section className="tiles">
        <div className="tile">
          <span className="tile-value">{Math.round(stats.completionRate * 100)}%</span>
          <span className="tile-label">{m.stats.completion}</span>
        </div>
        <div className="tile">
          <span className="tile-value">{stats.perfectDays}</span>
          <span className="tile-label">{m.stats.perfectDays}</span>
        </div>
        <div className="tile">
          <span className="tile-value ember">{stats.perfectStreak}🔥</span>
          <span className="tile-label">{m.stats.perfectStreak}</span>
        </div>
      </section>

      <RankCard />

      <section className="card">
        <div className="card-head">
          <h2>{p.heatmap}</h2>
          <span className="muted small">{m.stats.day(stats.day, stats.totalDays)}</span>
        </div>
        <div className="heatmap" role="grid">
          {cells.map((c) => (
            <button
              key={c.date}
              className={`cell ${c.state}${c.isToday ? " today" : ""}`}
              style={{ ["--level" as string]: c.level }}
              disabled={!c.editable}
              onClick={() => setEditing({ date: c.date, day: c.day })}
              aria-label={`${p.editDay(c.day)} · ${formatShortDate(c.date, locale)} · ${Math.round(c.level * 100)}%`}
            >
              {c.day}
            </button>
          ))}
        </div>
        <div className="legend">
          <span>
            <i className="cell missed" /> {p.legendNone}
          </span>
          <span>
            <i className="cell partial" style={{ ["--level" as string]: 0.5 }} /> {p.legendPartial}
          </span>
          <span>
            <i className="cell perfect" /> {p.legendPerfect}
          </span>
        </div>
        <p className="muted small">{p.tapDay}</p>
      </section>

      <section className="card">
        <h2>{p.perHabit}</h2>
        <table className="habit-table">
          <thead>
            <tr>
              <th />
              <th>{p.current}</th>
              <th>{p.best}</th>
              <th>{p.total}</th>
            </tr>
          </thead>
          <tbody>
            {stats.habits.map((h) => (
              <tr key={h.habit.id}>
                <th scope="row">
                  <span aria-hidden="true">{h.habit.emoji}</span> {h.habit.name}
                </th>
                <td className="ember">{h.currentStreak}🔥</td>
                <td>{h.longestStreak}</td>
                <td>{h.totalDone}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>{p.milestones}</h2>
        <ul className="milestones">
          {milestoneStates(stats).map((ms) => (
            <li key={ms.day} className={ms.reached ? "reached" : "locked"}>
              <span className="ms-badge">{ms.reached ? "🏅" : "🔒"}</span>
              <span className="ms-text">
                <strong>{p.locked(ms.day)}</strong>
                <span>{m.milestones[ms.day]}</span>
              </span>
              {ms.reached && <span className="ms-tag">{p.reached}</span>}
            </li>
          ))}
        </ul>
      </section>

      {editing && (
        <Modal
          sheet
          title={`${p.editDay(editing.day)} · ${formatShortDate(editing.date, locale)}`}
          onClose={() => setEditing(null)}
          closeLabel={ui.common.close}
        >
          <ul className="checklist compact">
            {activeHabits(data).map((h) => {
              const on = isDone(data, h.id, editing.date);
              const name = habitName(h, m);
              return (
                <li key={h.id}>
                  <button
                    className={`check-btn${on ? " on" : ""}`}
                    aria-pressed={on}
                    aria-label={on ? ui.today.uncheckLabel(name) : ui.today.checkLabel(name)}
                    onClick={() => update((d, now) => setCheckIn(d, h.id, editing.date, !on, now))}
                  >
                    <span className="check-emoji" aria-hidden="true">
                      {h.emoji}
                    </span>
                    <span className="check-name">{name}</span>
                    <span className="check-mark" aria-hidden="true">
                      {on ? "✓" : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button className="btn primary block" onClick={() => setEditing(null)}>
            {ui.common.done}
          </button>
        </Modal>
      )}
    </div>
  );
}
