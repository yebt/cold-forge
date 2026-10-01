import type { ISODate } from "@cold-forge/core";
import { useState } from "react";
import { formatShortDate } from "../i18n/index.ts";
import { heatmap, habitName } from "../lib/derive.ts";
import { milestoneStates } from "../lib/milestones.ts";
import { activeHabits, isDone, setCheckIn } from "../lib/model.ts";
import { useApp } from "../state.tsx";
import { HabitIcon, Icon } from "../ui/Icon.tsx";
import { Modal } from "../ui/Modal.tsx";
import { RankCard } from "../ui/RankCard.tsx";

export function Progress() {
  const { data, today, t, derived, update } = useApp();
  const { ui, m, locale } = t;
  const { stats } = derived;
  const [editing, setEditing] = useState<{ date: ISODate; day: number } | null>(null);
  const cells = heatmap(data, today);
  const p = ui.progress;
  const stored = new Map(data.habits.map((h) => [h.id, h]));
  const elapsed = stats.status === "upcoming" ? 0 : stats.day;

  return (
    <div className="progress">
      <header className="screen-head">
        <h1 className="screen-title">{p.title}</h1>
        {stats.status !== "upcoming" && <span className="label">{m.stats.day(stats.day, stats.totalDays)}</span>}
      </header>

      <section className="tiles" aria-label={p.title}>
        <div className="tile">
          <span className="tile-value">{stats.perfectDays}</span>
          <span className="tile-label">{m.stats.perfectDays}</span>
        </div>
        <div className="tile">
          <span className="tile-value ember">{stats.perfectStreak}</span>
          <span className="tile-label">{m.stats.perfectStreak}</span>
        </div>
        <div className="tile">
          <span className="tile-value">{Math.round(stats.completionRate * 100)}%</span>
          <span className="tile-label">{m.stats.completion}</span>
        </div>
      </section>

      <RankCard />

      <section className="card" aria-labelledby="heatmap-title">
        <div className="card-head">
          <h2 className="card-title" id="heatmap-title">
            {p.heatmapTitle(stats.totalDays)}
          </h2>
          <span className="label-num">{p.tapDayShort}</span>
        </div>
        <div className="heatmap">
          {cells.map((c) => (
            <button
              key={c.date}
              type="button"
              className={`cell ${c.state}${c.isToday ? " today" : ""}${c.state === "partial" && c.level >= 0.5 ? " high" : ""}`}
              disabled={!c.editable}
              onClick={() => setEditing({ date: c.date, day: c.day })}
              aria-label={`${p.editDay(c.day)} · ${formatShortDate(c.date, locale)} · ${Math.round(c.level * 100)}%`}
            />
          ))}
        </div>
        <div className="legend">
          <span>
            <i className="swatch missed" /> {p.legendNone}
          </span>
          <span>
            <i className="swatch partial" /> {p.legendPartial}
          </span>
          <span>
            <i className="swatch perfect" /> {p.legendPerfect}
          </span>
        </div>
      </section>

      <section aria-labelledby="per-habit-title">
        <h2 className="section-label" id="per-habit-title">
          {p.perHabit}
        </h2>
        <ul className="stat-rows">
          {stats.habits.map((h) => {
            const s = stored.get(h.habit.id);
            return (
              <li key={h.habit.id}>
                <HabitIcon habit={{ templateId: s?.templateId, emoji: h.habit.emoji }} size="sm" />
                <span className="stat-text">
                  <span className="stat-name">{h.habit.name}</span>
                  <span className="stat-value">{p.habitStat(h.currentStreak, h.longestStreak, h.totalDone, elapsed)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="milestones-title">
        <h2 className="section-label" id="milestones-title">
          {p.milestones}
        </h2>
        <ul className="milestones">
          {milestoneStates(stats).map((ms) => (
            <li key={ms.day} className={ms.reached ? "reached" : "locked"}>
              <span className="ms-day">{ms.day}</span>
              <span className="ms-text">
                <strong>{m.milestones[ms.day]}</strong>
                <span>{ms.reached ? p.reached : p.locked(ms.day)}</span>
              </span>
              <Icon name={ms.reached ? "medal" : "lock"} size={18} className="ms-icon" />
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
                    type="button"
                    className={`habit-row${on ? " on" : ""}`}
                    aria-pressed={on}
                    aria-label={on ? ui.today.uncheckLabel(name) : ui.today.checkLabel(name)}
                    onClick={() => update((d, now) => setCheckIn(d, h.id, editing.date, !on, now))}
                  >
                    <HabitIcon habit={h} />
                    <span className="habit-text">
                      <span className="habit-name">{name}</span>
                    </span>
                    <span className="check-mark" aria-hidden="true">
                      {on && <Icon name="check" size={20} strokeWidth={3} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button type="button" className="btn primary block" onClick={() => setEditing(null)}>
            {ui.common.done}
          </button>
        </Modal>
      )}
    </div>
  );
}
