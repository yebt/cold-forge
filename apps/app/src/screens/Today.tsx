import { diffDays } from "@cold-forge/core";
import { useEffect, useState } from "react";
import { formatWeekdayDate } from "../i18n/index.ts";
import { dayProgress } from "../lib/derive.ts";
import { activeHabits, isDone, setCheckIn } from "../lib/model.ts";
import { hapticImpact, hapticSuccess, playClang, playFanfare } from "../platform/feedback.ts";
import { InstallBanner } from "../pwa/index.ts";
import { useApp } from "../state.tsx";
import { ForgeRing, useTicker } from "../ui/ForgeRing.tsx";
import { HabitIcon, Icon } from "../ui/Icon.tsx";
import { burstFromElement, celebrate } from "../ui/sparks.ts";

export function Today({ onNewArc }: { onNewArc: () => void }) {
  const { data, today, t, derived, update } = useApp();
  const { ui, m, locale } = t;
  const { stats } = derived;
  /** The full-screen "perfect day" moment (auto-dismisses; never takes taps or scrolls). */
  const [celebration, setCelebration] = useState<string | null>(null);

  useEffect(() => {
    if (!celebration) return;
    const id = setTimeout(() => setCelebration(null), 3200);
    return () => clearTimeout(id);
  }, [celebration]);

  const habits = activeHabits(data);
  const { done, total } = dayProgress(data, today);
  const perfect = total > 0 && done >= total;
  const active = stats.status === "active";
  const statsFor = new Map(stats.habits.map((h) => [h.habit.id, h]));
  const hardDay = active && stats.day > 1 && stats.perfectStreak === 0;
  const streakShown = useTicker(stats.perfectStreak, 90);
  const msgs = ui.today.perfectMessages;

  const toggle = (habitId: string, el: HTMLElement) => {
    const wasDone = isDone(data, habitId, today);
    update((d, now) => setCheckIn(d, habitId, today, !wasDone, now));
    if (wasDone) return;
    burstFromElement(el);
    if (data.settings.haptics) void hapticImpact();
    if (done + 1 === total) {
      setTimeout(() => {
        celebrate();
        if (data.settings.haptics) void hapticSuccess();
        if (data.settings.sound) playFanfare();
      }, 180);
      const line = msgs[Math.floor(Math.random() * msgs.length)] ?? ui.today.allDone;
      setCelebration(line);
    } else if (data.settings.sound) {
      playClang();
    }
  };

  return (
    <div className="today">
      <header className="today-head">
        <div className="today-title">
          <p className="label eyebrow">
            <span>{formatWeekdayDate(today, locale)}</span>
            <span aria-hidden="true"> · </span>
            <span>{stats.title}</span>
          </p>
          {stats.status === "upcoming" ? (
            <h1 className="display-title">{ui.today.upcomingTitle}</h1>
          ) : (
            <h1 className="day-big" aria-label={ui.today.dayOf(stats.day, stats.totalDays)}>
              <span className="day-num">
                {ui.today.dayWord} {stats.day}
              </span>
              <span className="day-total">/ {stats.totalDays}</span>
            </h1>
          )}
        </div>
        <div className={`streak${stats.perfectStreak > 0 ? " hot" : ""}`}>
          <span className="streak-num" aria-hidden="true">
            {streakShown}
          </span>
          <span className="label" aria-hidden="true">{ui.today.streak}</span>
          <span className="sr-only">
            {m.stats.perfectStreak}: {stats.perfectStreak}
          </span>
        </div>
      </header>

      {active && habits.length > 0 && (
        <section className={`forge${perfect ? " perfect" : ""}`} aria-label={ui.today.heat}>
          <ForgeRing done={done} total={total} label={ui.today.heat} />
          <div className="forge-body">
            <span className="label">{ui.today.heat}</span>
            <span className="forge-status" role="status">
              {perfect ? ui.today.perfectDay : ui.today.habitsDone(done, total)}
            </span>
            <div className="segments" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}>
              {habits.map((h, i) => (
                <span key={h.id} className={i < done ? "on" : ""} style={{ ["--i" as string]: i }} />
              ))}
            </div>
            <span className="forge-meta">{ui.today.daysLeft(stats.daysRemaining)}</span>
          </div>
        </section>
      )}

      {data.arc.why && (
        <blockquote className={`why${hardDay ? " hard" : ""}`}>
          {hardDay && <span className="why-label">{ui.today.hardDay}</span>}“{data.arc.why}”
        </blockquote>
      )}

      {stats.status === "upcoming" && (
        <section className="card state-card">
          <span className="state-icon">
            <Icon name="snow" size={28} />
          </span>
          <p>{ui.today.upcomingBody(diffDays(today, data.arc.startDate))}</p>
        </section>
      )}

      {stats.status === "finished" && (
        <section className="card state-card">
          <span className="label">{ui.today.finishedTitle}</span>
          <strong className="state-rank">{m.ranks[stats.rank.id]}</strong>
          <p>{ui.today.finishedBody}</p>
          <p className="muted small">
            {m.stats.perfectDays}: <strong>{stats.perfectDays}</strong>
          </p>
          <button type="button" className="btn primary block" onClick={onNewArc}>
            {ui.today.newArc}
          </button>
        </section>
      )}

      {active &&
        (habits.length === 0 ? (
          <section className="card state-card">
            <p className="muted">{ui.today.noHabits}</p>
          </section>
        ) : (
          <ul className="checklist">
            {habits.map((h) => {
              const isOn = isDone(data, h.id, today);
              const name = h.templateId ? m.habits[h.templateId] : h.name;
              const hs = statsFor.get(h.id);
              return (
                <li key={h.id}>
                  <button
                    type="button"
                    className={`habit-row${isOn ? " on" : ""}`}
                    aria-pressed={isOn}
                    aria-label={isOn ? ui.today.uncheckLabel(name) : ui.today.checkLabel(name)}
                    onClick={(e) => toggle(h.id, e.currentTarget.querySelector(".check-mark") ?? e.currentTarget)}
                  >
                    <HabitIcon habit={h} />
                    <span className="habit-text">
                      <span className="habit-name">{name}</span>
                      <span className="habit-meta">
                        {ui.today.habitStreak(hs?.currentStreak ?? 0, hs?.longestStreak ?? 0)}
                      </span>
                    </span>
                    <span className="check-mark" aria-hidden="true">
                      {isOn && <Icon name="check" size={20} strokeWidth={3} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ))}

      {active && done === 0 && habits.length > 0 && <p className="hint">{ui.today.tapToForge}</p>}

      {celebration && (
        <div className="celebration" role="status" aria-live="polite">
          <div className="celebration-inner">
            <span className="celebration-icon">
              <Icon name="flame" size={44} strokeWidth={1.6} />
            </span>
            <strong>{ui.today.perfectDay}</strong>
            <span>{celebration}</span>
          </div>
        </div>
      )}
      {/* Dismissible, below the day's work: never in the way of checking in. */}
      <InstallBanner locale={t.locale} />
    </div>
  );
}
