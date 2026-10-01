/** The daily brag card. */

import type { HabitStats } from "@cold-forge/core";
import type { ShareCardInput } from "../types.ts";
import {
  drawBackground,
  drawFrost,
  drawIceCracks,
  drawSnowflakes,
  drawSparks,
  drawVignette,
  emoji,
  fittedText,
  footer,
  glowText,
  measureAt,
  measureWith,
  panel,
  progressBar,
  roundRectPath,
  trackedText,
  type Paint,
} from "../draw.ts";
import { computeHeatmap, HEATMAP_LEVELS, longestPerfectRun, type HeatmapCell } from "../heatmap.ts";
import { gridLayout } from "../layout.ts";
import { fitFontSize, splitDayLabel, splitLabel, truncateToWidth } from "../text.ts";
import { COLORS, CONTENT_WIDTH, SAFE, WIDTH, font } from "../theme.ts";
import { displayNameLine, headline, kicker, statTiles } from "./common.ts";

const Y = {
  kicker: 318,
  name: 372,
  dayPrefix: 458,
  dayNumber: 712,
  bar: 760,
  barLabel: 838,
  tiles: 876,
  tilesH: 206,
  heat: 1108,
  heatH: 192,
  habits: 1330,
  habitsBottom: SAFE.bottom,
  footer: 1790,
} as const;

export function paintStory(p: Paint, input: ShareCardInput): void {
  const { ctx } = p;
  const { stats, messages: m } = input;

  drawBackground(p);
  drawFrost(p);
  drawIceCracks(p, 7);
  drawSnowflakes(p, 9);
  drawSparks(p, 60, { top: 1150 });
  drawVignette(ctx);

  kicker(p, headline(input), Y.kicker);
  displayNameLine(p, input.displayName, Y.name);

  if (stats.status === "upcoming") {
    // "92 days" (— starting soon, in the kicker) reads better than "Day 0/92".
    const label = m.days(stats.totalDays);
    dayBlock(p, label, splitLabel(label, String(stats.totalDays), String(stats.totalDays)));
  } else {
    const label = m.stats.day(stats.day, stats.totalDays);
    dayBlock(p, label, splitDayLabel(label, stats.day, stats.totalDays));
  }

  const fraction = stats.totalDays ? stats.day / stats.totalDays : 0;
  progressBar(ctx, SAFE.side, Y.bar, CONTENT_WIDTH, 32, fraction);
  ctx.save();
  ctx.font = font(800, 32, p.family);
  ctx.fillStyle = COLORS.ice;
  ctx.textAlign = "left";
  fittedText(ctx, m.share.ofArc(Math.round(fraction * 100)), SAFE.side + 4, Y.barLabel, CONTENT_WIDTH * 0.6);
  ctx.textAlign = "right";
  ctx.fillStyle = COLORS.textMuted;
  fittedText(ctx, `${m.stats.perfectDays}: ${stats.perfectDays}`, WIDTH - SAFE.side - 4, Y.barLabel, CONTENT_WIDTH * 0.38);
  ctx.restore();

  const cells = computeHeatmap(
    input.arc,
    input.checkIns,
    stats.habits.map((h) => h.habit.id),
    stats.today,
  );
  // Once the arc is over the "current" streak is 0; brag about the best run instead.
  const finished = stats.status === "finished";
  const streak = finished ? Math.max(stats.perfectStreak, longestPerfectRun(cells)) : stats.perfectStreak;

  statTiles(
    p,
    [
      { icon: "🔥", value: String(streak), label: m.stats.perfectStreak, accent: COLORS.emberHot },
      { icon: "✅", value: `${Math.round(stats.completionRate * 100)}%`, label: m.stats.completion },
      { icon: stats.rank.emoji, value: m.ranks[stats.rank.id], label: m.stats.rank, accent: COLORS.ice, weight: 1.3 },
    ],
    Y.tiles,
    Y.tilesH,
  );

  heatmap(p, cells, Y.heat, Y.heatH);

  habitRows(p, input, stats.habits, input.maxHabits ?? 5, finished);

  footer(p, Y.footer);
}

/** "DAY" small and tracked, then the number huge with an ember gradient and "/92" muted. */
function dayBlock(p: Paint, label: string, parts: ReturnType<typeof splitLabel>): void {
  const { ctx, family } = p;
  ctx.save();
  ctx.textBaseline = "alphabetic";
  if (!parts) {
    const size = fitFontSize(label, CONTENT_WIDTH, 200, 80, measureAt(ctx, 900, family));
    ctx.font = font(900, size, family);
    ctx.textAlign = "center";
    glowText(ctx, label, WIDTH / 2, Y.dayNumber, "rgba(249,115,22,0.6)", 50, COLORS.text);
    ctx.restore();
    return;
  }

  if (parts.prefix) {
    ctx.font = font(900, 56, family);
    ctx.fillStyle = COLORS.iceFrost;
    ctx.shadowColor = "rgba(125, 211, 252, 0.6)";
    ctx.shadowBlur = 20;
    trackedText(ctx, parts.prefix.toLocaleUpperCase(), WIDTH / 2, Y.dayPrefix, 16, "center");
    ctx.shadowBlur = 0;
  }

  // Number + suffix measured together so the pair is centered.
  let numSize = 272;
  const suffixRatio = 0.4;
  const gap = /^\s/.test(parts.suffix) ? 0 : 14;
  const widthAt = (size: number) => {
    ctx.font = font(900, size, family);
    const n = ctx.measureText(parts.number).width;
    ctx.font = font(900, size * suffixRatio, family);
    const s = ctx.measureText(parts.suffix).width;
    return { n, s, total: n + gap + s };
  };
  while (numSize > 120 && widthAt(numSize).total > CONTENT_WIDTH) numSize -= 6;
  const w = widthAt(numSize);
  const x0 = WIDTH / 2 - w.total / 2;

  ctx.font = font(900, numSize, family);
  ctx.textAlign = "left";
  const top = Y.dayNumber - numSize * 0.72;
  const g = ctx.createLinearGradient(0, top, 0, Y.dayNumber);
  g.addColorStop(0, "#FFFFFF");
  g.addColorStop(0.45, COLORS.emberHot);
  g.addColorStop(1, COLORS.ember);
  glowText(ctx, parts.number, x0, Y.dayNumber, "rgba(249, 115, 22, 0.75)", 60, g);

  ctx.font = font(900, numSize * suffixRatio, family);
  ctx.fillStyle = "rgba(125, 211, 252, 0.75)";
  ctx.fillText(parts.suffix, x0 + w.n + gap, Y.dayNumber);
  ctx.restore();
}

const HEAT_COLORS: readonly string[] = [
  "rgba(148, 163, 184, 0.22)", // a past day with nothing done: visibly "missed", unlike future days
  "#0E4D6E",
  "#1683B5",
  "#38BDF8",
  "#BAE6FD",
];

function heatmap(p: Paint, cells: readonly HeatmapCell[], y: number, h: number): void {
  const { ctx } = p;
  panel(ctx, SAFE.side, y, CONTENT_WIDTH, h, 30);
  const pad = 26;
  const rows = 4;
  const grid = gridLayout(cells.length, CONTENT_WIDTH - pad * 2, rows, 6);
  const gx = SAFE.side + pad;
  const gy = y + (h - grid.height) / 2;
  ctx.save();
  cells.forEach((cell, i) => {
    const r = grid.rects[i]!;
    const x = gx + r.x;
    const cy = gy + r.y;
    roundRectPath(ctx, x, cy, r.w, r.h, r.w * 0.24);
    if (cell.state === "future") {
      ctx.fillStyle = "rgba(125, 211, 252, 0.03)";
      ctx.fill();
      ctx.strokeStyle = "rgba(125, 211, 252, 0.12)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      return;
    }
    const level = Math.min(cell.level, HEATMAP_LEVELS - 1);
    if (level === HEATMAP_LEVELS - 1) {
      ctx.shadowColor = "rgba(125, 211, 252, 0.8)";
      ctx.shadowBlur = 12;
    }
    ctx.fillStyle = HEAT_COLORS[level]!;
    ctx.fill();
    ctx.shadowBlur = 0;
    if (cell.state === "today") {
      ctx.save();
      roundRectPath(ctx, x - 4, cy - 4, r.w + 8, r.h + 8, r.w * 0.3);
      ctx.strokeStyle = COLORS.ember;
      ctx.lineWidth = 4;
      ctx.shadowColor = COLORS.ember;
      ctx.shadowBlur = 16;
      ctx.stroke();
      ctx.restore();
    }
  });
  ctx.restore();
}

function habitRows(p: Paint, input: ShareCardInput, habits: readonly HabitStats[], max: number, best: boolean): void {
  const { ctx, family } = p;
  const top = Y.habits;
  const available = Y.habitsBottom - top;

  if (habits.length === 0) {
    // Nothing to list: use the space for the tagline.
    ctx.save();
    ctx.textAlign = "center";
    const tag = input.messages.tagline;
    const size = fitFontSize(tag, CONTENT_WIDTH, 64, 36, measureAt(ctx, 900, family));
    ctx.font = font(900, size, family);
    glowText(ctx, tag, WIDTH / 2, top + available / 2, "rgba(56, 189, 248, 0.6)", 30, COLORS.iceFrost);
    ctx.restore();
    return;
  }

  const limit = Math.max(1, max);
  const overflow = habits.length > limit ? habits.length - (limit - 1) : 0;
  const shown = overflow ? habits.slice(0, limit - 1) : habits.slice(0, limit);
  const rowCount = shown.length + (overflow ? 1 : 0);
  const rowH = Math.min(68, Math.floor(available / Math.max(rowCount, 1)));
  const x = SAFE.side + 12;
  const right = WIDTH - SAFE.side - 12;

  ctx.save();
  ctx.textBaseline = "middle";
  shown.forEach((h, i) => {
    const cy = top + rowH * i + rowH / 2;
    if (i > 0) {
      ctx.fillStyle = "rgba(125, 211, 252, 0.10)";
      ctx.fillRect(x, top + rowH * i, right - x, 2);
    }
    // Done-today dot (always lit once the arc is over).
    const lit = h.doneToday || best;
    ctx.beginPath();
    ctx.arc(x + 10, cy, 9, 0, Math.PI * 2);
    if (lit) {
      ctx.fillStyle = COLORS.ice;
      ctx.shadowColor = COLORS.ice;
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.strokeStyle = "rgba(125, 211, 252, 0.45)";
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    ctx.textAlign = "left";
    emoji(ctx, h.habit.emoji || "•", x + 38, cy + 2, 44, family);

    // Streak on the right.
    ctx.textAlign = "right";
    ctx.font = font(900, 42, family);
    const n = best ? Math.max(h.currentStreak, h.longestStreak) : h.currentStreak;
    const streak = `${n}`;
    ctx.fillStyle = n > 0 ? COLORS.emberHot : COLORS.textDim;
    const flameW = 50;
    ctx.fillText(streak, right - flameW, cy + 2);
    const streakW = ctx.measureText(streak).width;
    emoji(ctx, "🔥", right, cy + 2, 38, family, n > 0 ? 1 : 0.35);

    ctx.textAlign = "left";
    ctx.font = font(800, 40, family);
    ctx.fillStyle = lit ? COLORS.text : "rgba(226, 232, 240, 0.78)";
    const nameX = x + 104;
    const maxName = right - flameW - streakW - 28 - nameX;
    ctx.fillText(truncateToWidth(h.habit.name, maxName, measureWith(ctx)), nameX, cy + 2);
  });

  if (overflow) {
    const i = shown.length;
    const cy = top + rowH * i + rowH / 2;
    ctx.fillStyle = "rgba(125, 211, 252, 0.10)";
    ctx.fillRect(x, top + rowH * i, right - x, 2);
    ctx.textAlign = "left";
    ctx.font = font(900, 38, family);
    ctx.fillStyle = COLORS.ice;
    const label = `+${overflow}`;
    ctx.fillText(label, x + 38, cy + 2);
    const lw = ctx.measureText(label).width;
    ctx.font = font(400, 36, family);
    const rest = habits.slice(shown.length).map((h) => h.habit.emoji || "•").join(" ");
    emoji(ctx, truncateToWidth(rest, right - (x + 66 + lw), measureWith(ctx)), x + 66 + lw, cy + 2, 36, family);
  }
  ctx.restore();
}
