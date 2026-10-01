import { progressBar, type ArcStats } from "@cold-forge/core";
import type { Messages } from "./en.ts";

/** Plain-text brag card, ready to paste into X, Instagram stories, WhatsApp, etc. */
export function buildShareText(stats: ArcStats, m: Messages): string {
  const arcFraction = stats.day / stats.totalDays;
  const header =
    stats.status === "upcoming"
      ? m.share.upcoming(stats.title)
      : stats.status === "finished"
        ? m.share.finished(stats.title, stats.totalDays)
        : m.share.active(stats.title, stats.day, stats.totalDays);

  const lines = [
    header,
    `${progressBar(arcFraction)} ${m.share.ofArc(Math.round(arcFraction * 100))}`,
    "",
    m.share.perfectStreak(stats.perfectStreak),
    m.share.completion(Math.round(stats.completionRate * 100)),
    m.share.rank(stats.rank.emoji, m.ranks[stats.rank.id]),
  ];

  if (stats.habits.length > 0) {
    lines.push("");
    for (const h of stats.habits) {
      lines.push(m.share.habitLine(h.habit.emoji, h.habit.name, h.currentStreak, h.totalDone));
    }
  }

  lines.push("", m.share.footer);
  return lines.join("\n");
}
