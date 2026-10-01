import type { ArcStats } from "./types.ts";

const BAR_WIDTH = 10;

const days = (n: number) => `${n} ${n === 1 ? "día" : "días"}`;

export function progressBar(fraction: number, width = BAR_WIDTH): string {
  const filled = Math.round(Math.min(Math.max(fraction, 0), 1) * width);
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

/** Plain-text brag card, ready to paste into X, Instagram stories, WhatsApp, etc. */
export function buildShareText(stats: ArcStats): string {
  const pct = Math.round(stats.completionRate * 100);
  const header =
    stats.status === "upcoming"
      ? `❄️ ${stats.title} — empieza pronto`
      : stats.status === "finished"
        ? `❄️ ${stats.title} — COMPLETADO (${days(stats.totalDays)})`
        : `❄️ ${stats.title} — Día ${stats.day}/${stats.totalDays}`;

  const lines = [
    header,
    `${progressBar(stats.day / stats.totalDays)} ${Math.round((stats.day / stats.totalDays) * 100)}% del arc`,
    "",
    `🔥 Racha perfecta: ${days(stats.perfectStreak)}`,
    `✅ Cumplimiento: ${pct}%`,
    `${stats.rank.emoji} Rango: ${stats.rank.name}`,
  ];

  if (stats.habits.length > 0) {
    lines.push("");
    for (const h of stats.habits) {
      lines.push(`${h.habit.emoji} ${h.habit.name} — ${h.currentStreak}🔥 (${days(h.totalDone)})`);
    }
  }

  lines.push("", "Forjado con COLD FORGE 🧊⚒️ #WinterArc");
  return lines.join("\n");
}
