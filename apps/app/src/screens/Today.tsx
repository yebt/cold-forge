import { diffDays } from "@cold-forge/core";
import { useEffect, useState } from "react";
import { dayProgress } from "../lib/derive.ts";
import { activeHabits, isDone, setCheckIn } from "../lib/model.ts";
import { hapticImpact, hapticSuccess, playClang, playFanfare } from "../platform/feedback.ts";
import { InstallBanner } from "../pwa/index.ts";
import { useApp } from "../state.tsx";
import { ForgeRing } from "../ui/ForgeRing.tsx";
import { burstFromElement, celebrate } from "../ui/sparks.ts";

export function Today({ onNewArc }: { onNewArc: () => void }) {
  const { data, today, t, derived, update } = useApp();
  const { ui, m } = t;
  const { stats } = derived;
  const [celebration, setCelebration] = useState<string | null>(null);

  useEffect(() => {
    if (!celebration) return;
    const id = setTimeout(() => setCelebration(null), 3200);
    return () => clearTimeout(id);
  }, [celebration]);

  const habits = activeHabits(data);
  const { done, total } = dayProgress(data, today);
  const active = stats.status === "active";
  const streakFor = new Map(stats.habits.map((h) => [h.habit.id, h.currentStreak]));
  const hardDay = active && stats.day > 1 && stats.perfectStreak === 0;

  const toggle = (habitId: string, el: HTMLElement) => {
    const wasDone = isDone(data, habitId, today);
    update((d, now) => setCheckIn(d, habitId, today, !wasDone, now));
    if (wasDone) return;
    burstFromElement(el);
    if (data.settings.haptics) void hapticImpact();
    const perfect = done + 1 === total;
    if (perfect) {
      setTimeout(() => {
        celebrate();
        if (data.settings.haptics) void hapticSuccess();
        if (data.settings.sound) playFanfare();
      }, 180);
      const msgs = ui.today.perfectMessages;
      setCelebration(msgs[Math.floor(Math.random() * msgs.length)] ?? ui.today.allDone);
    } else if (data.settings.sound) {
      playClang();
    }
  };

  return (
    <div className="today">
      <header className="today-head">
        <div className="head-row">
          <span className="brand">COLD FORGE</span>
          <span className={`streak-badge${stats.perfectStreak > 0 ? " hot" : ""}`} title={m.stats.perfectStreak}>
            🔥 <strong>{stats.perfectStreak}</strong>
            <span className="sr-only"> {m.stats.perfectStreak}</span>
          </span>
        </div>
        {stats.status === "upcoming" ? (
          <h1 className="day-big">
            {ui.today.upcomingTitle}
          </h1>
        ) : (
          <>
            <h1 className="day-big" aria-label={ui.today.dayOf(stats.day, stats.totalDays)}>
              <span className="day-word">{ui.today.dayWord}</span>
              <span className="day-num">{stats.day}</span>
              <span className="day-total">/{stats.totalDays}</span>
            </h1>
            <p className="day-meta">
              {stats.title} · {stats.status === "finished" ? ui.today.finishedTitle : ui.today.daysLeft(stats.daysRemaining)}
            </p>
          </>
        )}
        {data.arc.why && (
          <blockquote className={`why${hardDay ? " hard" : ""}`}>
            {hardDay && <span className="why-label">{ui.today.hardDay}</span>}
            “{data.arc.why}”
          </blockquote>
        )}
      </header>

      {stats.status === "upcoming" && (
        <section className="card state-card">
          <span className="state-emoji">🧊</span>
          <p>{ui.today.upcomingBody(diffDays(today, data.arc.startDate))}</p>
        </section>
      )}

      {stats.status === "finished" && (
        <section className="card state-card">
          <span className="state-emoji">{stats.rank.emoji}</span>
          <h2>{ui.today.finishedTitle}</h2>
          <p>{ui.today.finishedBody}</p>
          <p className="muted">
            {m.stats.perfectDays}: <strong>{stats.perfectDays}</strong> · {m.ranks[stats.rank.id]}
          </p>
          <button className="btn primary" onClick={onNewArc}>
            {ui.today.newArc}
          </button>
        </section>
      )}

      {active && (
        <>
          <section className="heat">
            <ForgeRing done={done} total={total} label={ui.today.heat} />
            <div className="heat-text">
              <span className="eyebrow">{ui.today.heat}</span>
              <strong>{total > 0 && done >= total ? ui.today.allDone : ui.today.doneOf(done, total)}</strong>
              {done === 0 && <span className="muted small">{ui.today.tapToForge}</span>}
            </div>
          </section>

          {habits.length === 0 ? (
            <p className="muted">{ui.today.noHabits}</p>
          ) : (
            <ul className="checklist">
              {habits.map((h) => {
                const isOn = isDone(data, h.id, today);
                const name = h.templateId ? m.habits[h.templateId] : h.name;
                const streak = streakFor.get(h.id) ?? 0;
                return (
                  <li key={h.id}>
                    <button
                      className={`check-btn${isOn ? " on" : ""}`}
                      aria-pressed={isOn}
                      aria-label={isOn ? ui.today.uncheckLabel(name) : ui.today.checkLabel(name)}
                      onClick={(e) => toggle(h.id, e.currentTarget.querySelector(".check-mark") ?? e.currentTarget)}
                    >
                      <span className="check-emoji" aria-hidden="true">
                        {h.emoji}
                      </span>
                      <span className="check-name">{name}</span>
                      {streak > 0 && <span className="check-streak">{streak}🔥</span>}
                      <span className="check-mark" aria-hidden="true">
                        {isOn ? "✓" : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {celebration && (
        <div className="celebration" role="status" onClick={() => setCelebration(null)}>
          <div className="celebration-inner">
            <span className="celebration-emoji">🔥</span>
            <strong>{ui.today.allDone}</strong>
            <span>{celebration}</span>
          </div>
        </div>
      )}
      {/* Dismissible, below the day's work: never in the way of checking in. */}
      <InstallBanner locale={t.locale} />
    </div>
  );
}
