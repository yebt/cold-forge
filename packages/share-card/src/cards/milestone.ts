/** Celebration card for milestone days (7/30/50/75/92). Day 92 gets the trophy treatment. */

import { ARC_DAYS } from "@cold-forge/core";
import type { ShareCardInput } from "../types.ts";
import {
  drawBackground,
  drawFrost,
  drawIceCracks,
  drawSnowflakes,
  drawSparks,
  drawVignette,
  emoji,
  footer,
  glowText,
  measureWith,
  radialGlow,
  trackedText,
  type Ctx,
  type Paint,
} from "../draw.ts";
import { computeHeatmap, longestPerfectRun } from "../heatmap.ts";
import type { Rng } from "../rng.ts";
import { splitDayLabel, wrapText } from "../text.ts";
import { COLORS, CONTENT_WIDTH, WIDTH, font } from "../theme.ts";
import { displayNameLine, kicker, statTiles } from "./common.ts";

const CX = WIDTH / 2;
const CY = 824;
const RING_R = 300;

export function paintMilestone(p: Paint, input: ShareCardInput): void {
  const { ctx, family, rng } = p;
  const { stats, messages: m } = input;
  const day = input.milestoneDay ?? stats.day;
  const total = stats.totalDays || ARC_DAYS;
  const final = day >= total;
  const accent = final ? COLORS.gold : COLORS.ember;

  drawBackground(p, { emberStrength: final ? 1.5 : 1.25, iceStrength: 0.9 });
  drawFrost(p, 2200);
  drawIceCracks(p, 6);
  drawSnowflakes(p, 8);
  rays(ctx, rng, final);
  drawSparks(p, final ? 150 : 100, { top: 380, hot: final });
  drawVignette(ctx);

  kicker(p, stats.title, 318);
  displayNameLine(p, input.displayName, 372);

  medallion(ctx, rng, final);
  if (final) laurels(ctx, rng);

  // Number inside the medallion.
  const parts = splitDayLabel(m.stats.day(day, total), day, total);
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  if (parts?.prefix) {
    ctx.font = font(900, 50, family);
    ctx.fillStyle = COLORS.iceFrost;
    trackedText(ctx, parts.prefix.toLocaleUpperCase(), CX, CY - 150, 18, "center");
  }
  const number = String(day);
  let size = 330;
  ctx.font = font(900, size, family);
  while (size > 160 && ctx.measureText(number).width > RING_R * 1.6) {
    size -= 6;
    ctx.font = font(900, size, family);
  }
  const baseline = CY + size * 0.36;
  const g = ctx.createLinearGradient(0, baseline - size * 0.72, 0, baseline);
  g.addColorStop(0, "#FFFFFF");
  g.addColorStop(0.4, final ? "#FEF3C7" : COLORS.emberHot);
  g.addColorStop(1, accent);
  glowText(ctx, number, CX, baseline, final ? "rgba(252, 211, 77, 0.8)" : "rgba(249, 115, 22, 0.85)", 70, g);
  ctx.font = font(900, 46, family);
  ctx.fillStyle = "rgba(186, 230, 253, 0.8)";
  trackedText(ctx, `${day}/${total}`, CX, CY + 205, 10, "center");
  ctx.restore();

  if (final) {
    ctx.save();
    radialGlow(ctx, CX, CY - RING_R - 20, 150, "rgba(252, 211, 77, 0.35)");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    emoji(ctx, "🏆", CX, CY - RING_R - 22, 116, family);
    ctx.restore();
  }

  // Milestone title: up to two lines, shrinking for long translations.
  const title = m.milestones[day] ?? m.stats.day(day, total);
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  let tSize = 84;
  let lines: string[] = [];
  for (; tSize >= 52; tSize -= 4) {
    ctx.font = font(900, tSize, family);
    lines = wrapText(title, CONTENT_WIDTH, 2, measureWith(ctx));
    if (!lines.some((l) => l.endsWith("…"))) break;
  }
  tSize = Math.max(tSize, 52);
  ctx.font = font(900, tSize, family);
  const lineH = tSize * 1.08;
  const titleTop = 1300 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((line, i) => {
    glowText(ctx, line, CX, titleTop + i * lineH, final ? "rgba(252, 211, 77, 0.5)" : "rgba(56, 189, 248, 0.55)", 30, COLORS.text);
  });
  ctx.restore();

  statTiles(
    p,
    [
      { icon: "🔥", value: String(bestStreak(input)), label: m.stats.perfectStreak, accent: COLORS.emberHot },
      { icon: "✅", value: `${Math.round(stats.completionRate * 100)}%`, label: m.stats.completion },
      { icon: stats.rank.emoji, value: m.ranks[stats.rank.id], label: m.stats.rank, accent: final ? COLORS.gold : COLORS.ice, weight: 1.3 },
    ],
    1414,
    206,
  );

  footer(p, 1790);
}

/** Alternating ice / fire light rays bursting from behind the medallion. */
function rays(ctx: Ctx, rng: Rng, final: boolean): void {
  const count = final ? 36 : 28;
  const len = 1100;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const rot = rng.range(0, Math.PI);
  for (let i = 0; i < count; i++) {
    const a = rot + (i / count) * Math.PI * 2;
    const spread = (Math.PI / count) * rng.range(0.2, 0.55);
    const fire = i % 2 === 0;
    const g = ctx.createRadialGradient(CX, CY, RING_R * 0.6, CX, CY, len);
    const color = fire ? (final ? "252, 211, 77" : "249, 115, 22") : "125, 211, 252";
    g.addColorStop(0, `rgba(${color}, ${final ? 0.13 : 0.1})`);
    g.addColorStop(1, `rgba(${color}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(CX, CY);
    ctx.arc(CX, CY, len, a - spread, a + spread);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  radialGlow(ctx, CX, CY, RING_R * 1.9, final ? "rgba(252, 211, 77, 0.22)" : "rgba(249, 115, 22, 0.22)");
}

/** Forged medallion: dark disc, ice outer ring with tick marks, ember inner ring. */
function medallion(ctx: Ctx, rng: Rng, final: boolean): void {
  ctx.save();
  // Disc.
  const disc = ctx.createRadialGradient(CX, CY - 80, 20, CX, CY, RING_R);
  disc.addColorStop(0, "rgba(30, 50, 85, 0.95)");
  disc.addColorStop(1, "rgba(7, 11, 18, 0.95)");
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(CX, CY, RING_R, 0, Math.PI * 2);
  ctx.fill();

  // Outer ring.
  const ring = ctx.createLinearGradient(CX - RING_R, CY - RING_R, CX + RING_R, CY + RING_R);
  ring.addColorStop(0, final ? "#FEF3C7" : COLORS.iceFrost);
  ring.addColorStop(0.5, final ? COLORS.gold : COLORS.iceDeep);
  ring.addColorStop(1, final ? "#B45309" : COLORS.ember);
  ctx.strokeStyle = ring;
  ctx.lineWidth = 14;
  ctx.shadowColor = final ? "rgba(252, 211, 77, 0.8)" : "rgba(56, 189, 248, 0.8)";
  ctx.shadowBlur = 40;
  ctx.beginPath();
  ctx.arc(CX, CY, RING_R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Inner thin ring.
  ctx.strokeStyle = final ? "rgba(252, 211, 77, 0.45)" : "rgba(249, 115, 22, 0.5)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(CX, CY, RING_R - 30, 0, Math.PI * 2);
  ctx.stroke();

  // 92 ticks, one per arc day.
  for (let i = 0; i < ARC_DAYS; i++) {
    const a = -Math.PI / 2 + (i / ARC_DAYS) * Math.PI * 2;
    const major = i % 7 === 0;
    const r1 = RING_R - 18;
    const r2 = RING_R - (major ? 6 : 11);
    ctx.strokeStyle = major ? "rgba(224, 242, 254, 0.7)" : "rgba(224, 242, 254, 0.28)";
    ctx.lineWidth = major ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(CX + Math.cos(a) * r1, CY + Math.sin(a) * r1);
    ctx.lineTo(CX + Math.cos(a) * r2, CY + Math.sin(a) * r2);
    ctx.stroke();
  }

  // A few frost shards on the ring.
  for (let i = 0; i < 6; i++) {
    const a = rng.range(0, Math.PI * 2);
    const x = CX + Math.cos(a) * RING_R;
    const y = CY + Math.sin(a) * RING_R;
    ctx.fillStyle = "rgba(224, 242, 254, 0.85)";
    ctx.beginPath();
    ctx.moveTo(x, y - rng.range(10, 22));
    ctx.lineTo(x + 5, y);
    ctx.lineTo(x, y + rng.range(6, 12));
    ctx.lineTo(x - 5, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Golden laurel branches hugging the medallion for the final day. */
function laurels(ctx: Ctx, rng: Rng): void {
  ctx.save();
  const r = RING_R + 40;
  const from = 0.62; // radians away from straight down, leaving room for the title
  const to = 2.45; // up towards the trophy
  for (const side of [-1, 1] as const) {
    // Stem.
    ctx.strokeStyle = "rgba(217, 119, 6, 0.9)";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    const a0 = Math.PI / 2 + side * from;
    const a1 = Math.PI / 2 + side * to;
    ctx.arc(CX, CY, r, Math.min(a0, a1), Math.max(a0, a1));
    ctx.stroke();

    const leaves = 11;
    for (let i = 0; i < leaves; i++) {
      const t = i / (leaves - 1);
      const a = Math.PI / 2 + side * (from + t * (to - from));
      const x = CX + Math.cos(a) * r;
      const y = CY + Math.sin(a) * r;
      const size = 46 - t * 16;
      // Direction of travel along the stem (towards the top).
      const along = a + side * (Math.PI / 2);
      for (const off of [-0.62, 0.62]) {
        const dir = along + off;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(dir);
        const g = ctx.createLinearGradient(0, 0, size, 0);
        g.addColorStop(0, rng.chance(0.5) ? "#B45309" : "#D97706");
        g.addColorStop(1, "#FDE68A");
        ctx.fillStyle = g;
        ctx.shadowColor = "rgba(252, 211, 77, 0.55)";
        ctx.shadowBlur = 12;
        // Pointed leaf: two quadratic curves.
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(size * 0.5, -size * 0.32, size, 0);
        ctx.quadraticCurveTo(size * 0.5, size * 0.32, 0, 0);
        ctx.fill();
        ctx.restore();
      }
    }
    // Berry-like tip.
    const tx = CX + Math.cos(a1) * r;
    const ty = CY + Math.sin(a1) * r;
    ctx.fillStyle = "#FDE68A";
    ctx.beginPath();
    ctx.arc(tx, ty, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** For a milestone shared after the fact (or a finished arc) the current streak may be 0; use the best run. */
function bestStreak(input: ShareCardInput): number {
  const { stats } = input;
  if (stats.status === "active") return stats.perfectStreak;
  const cells = computeHeatmap(input.arc, input.checkIns, stats.habits.map((h) => h.habit.id), stats.today);
  return Math.max(stats.perfectStreak, longestPerfectRun(cells));
}
