import { eachDay, progressBar, type Arc, type ArcStats, type CheckIn } from "@cold-forge/core";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "./api.ts";

interface Data {
  arc: Arc;
  stats: ArcStats;
  checkIns: CheckIn[];
}

export function App() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [arc, stats, checkIns] = await Promise.all([api.arc(), api.stats(), api.checkIns()]);
      setData({ arc, stats, checkIns });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = (action: Promise<unknown>) => action.then(refresh).catch((e) => setError(String(e.message ?? e)));

  if (!data) {
    return <main className="shell">{error ? <p className="error">No se pudo conectar: {error}</p> : <p>Calentando la forja…</p>}</main>;
  }

  const { arc, stats, checkIns } = data;
  return (
    <main className="shell">
      <Header stats={stats} />
      {error && <p className="error">{error}</p>}
      <StatTiles stats={stats} />
      <section className="card">
        <h2>Hoy</h2>
        {stats.status !== "active" && (
          <p className="muted">{stats.status === "upcoming" ? "El arc aún no empieza. Prepara tus hábitos." : "El arc terminó. Mira lo que forjaste."}</p>
        )}
        <ul className="habits">
          {stats.habits.map((h) => (
            <li key={h.habit.id} className={h.doneToday ? "done" : ""}>
              <button
                className="check"
                disabled={stats.status !== "active"}
                onClick={() => run(api.toggle(h.habit.id))}
                aria-label={`Marcar ${h.habit.name}`}
              >
                {h.doneToday ? "✓" : ""}
              </button>
              <span className="habit-name">
                {h.habit.emoji} {h.habit.name}
              </span>
              <span className="streak" title={`Mejor racha: ${h.longestStreak}`}>
                {h.currentStreak}🔥
              </span>
              <button
                className="ghost"
                onClick={() => confirm(`¿Borrar "${h.habit.name}" y su historial?`) && run(api.deleteHabit(h.habit.id))}
                aria-label={`Borrar ${h.habit.name}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <AddHabit onAdd={(name, emoji) => run(api.addHabit(name, emoji))} />
      </section>
      <Heatmap arc={arc} stats={stats} checkIns={checkIns} />
      <ShareCard stats={stats} />
    </main>
  );
}

function Header({ stats }: { stats: ArcStats }) {
  const fraction = stats.day / stats.totalDays;
  return (
    <header className="hero">
      <p className="brand">COLD FORGE</p>
      <h1>{stats.title}</h1>
      <p className="day">
        Día <strong>{stats.day}</strong> / {stats.totalDays}
        <span className="muted"> · faltan {stats.daysRemaining}</span>
      </p>
      <div className="bar" aria-label={`${Math.round(fraction * 100)}% del arc`}>
        <div style={{ width: `${fraction * 100}%` }} />
      </div>
    </header>
  );
}

function StatTiles({ stats }: { stats: ArcStats }) {
  const toNext = stats.nextRank ? stats.nextRank.minPerfectDays - stats.perfectDays : 0;
  return (
    <section className="tiles">
      <Tile label="Racha perfecta" value={`${stats.perfectStreak}🔥`} />
      <Tile label="Días perfectos" value={stats.perfectDays} />
      <Tile label="Cumplimiento" value={`${Math.round(stats.completionRate * 100)}%`} />
      <Tile
        label={stats.nextRank ? `Rango · ${toNext} para ${stats.nextRank.name}` : "Rango máximo"}
        value={`${stats.rank.emoji} ${stats.rank.name}`}
      />
    </section>
  );
}

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="tile">
      <span className="tile-value">{value}</span>
      <span className="tile-label">{label}</span>
    </div>
  );
}

function AddHabit({ onAdd }: { onAdd: (name: string, emoji: string) => void }) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🔥");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd(name, emoji);
    setName("");
  };
  return (
    <form className="add" onSubmit={submit}>
      <input className="emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={8} aria-label="Emoji" />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nuevo hábito (ej. Ducha fría)" maxLength={60} />
      <button type="submit">Añadir</button>
    </form>
  );
}

function Heatmap({ arc, stats, checkIns }: Data) {
  const counts = new Map<string, number>();
  for (const c of checkIns) counts.set(c.date, (counts.get(c.date) ?? 0) + 1);
  const total = arc.habits.length || 1;
  return (
    <section className="card">
      <h2>El arc completo</h2>
      <div className="heatmap">
        {eachDay(arc.startDate, arc.endDate).map((d) => {
          const level = Math.min((counts.get(d) ?? 0) / total, 1);
          const future = d > stats.today;
          return (
            <span
              key={d}
              title={`${d}: ${counts.get(d) ?? 0}/${arc.habits.length}`}
              className={`cell${future ? " future" : ""}${d === stats.today ? " today" : ""}`}
              style={{ "--level": level } as React.CSSProperties}
            />
          );
        })}
      </div>
    </section>
  );
}

function ShareCard({ stats }: { stats: ArcStats }) {
  const [status, setStatus] = useState<string | null>(null);
  const share = async () => {
    const { text } = await api.share();
    if (navigator.share) {
      await navigator.share({ text }).catch(() => {});
      return;
    }
    await navigator.clipboard.writeText(text);
    setStatus("¡Copiado! Pégalo donde quieras presumir.");
  };
  return (
    <section className="card share">
      <h2>Presume tu progreso</h2>
      <div className="brag">
        <p className="brag-title">❄️ {stats.title}</p>
        <p className="brag-day">
          Día {stats.day}/{stats.totalDays}
        </p>
        <p className="mono">{progressBar(stats.day / stats.totalDays)}</p>
        <p>
          🔥 {stats.perfectStreak} {stats.perfectStreak === 1 ? "día" : "días"} de racha · {stats.rank.emoji} {stats.rank.name}
        </p>
        <p className="muted">#WinterArc · COLD FORGE</p>
      </div>
      <button onClick={share}>Compartir</button>
      {status && <p className="muted">{status}</p>}
    </section>
  );
}
