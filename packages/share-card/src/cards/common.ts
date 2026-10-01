/** Building blocks used by both card designs. */

import type { ShareCardInput } from "../types.ts";
import { emoji, fittedText, measureAt, measureWith, panel, trackedText, trackedWidth, type Paint } from "../draw.ts";
import { columns } from "../layout.ts";
import { fitFontSize, truncateToWidth, wrapText } from "../text.ts";
import { COLORS, CONTENT_WIDTH, SAFE, WIDTH, font } from "../theme.ts";

/** The arc headline: title, or the localized "starting soon" / "complete" line. */
export function headline(input: ShareCardInput): string {
  const { stats, messages: m } = input;
  if (stats.status === "upcoming") return stripLeadingEmoji(m.share.upcoming(stats.title));
  if (stats.status === "finished") return stripLeadingEmoji(m.share.finished(stats.title, stats.totalDays));
  return stats.title;
}

/** The share-text strings start with "❄️ "; on the card we draw our own snowflakes. */
export function stripLeadingEmoji(text: string): string {
  return text.replace(/^\p{Extended_Pictographic}️?\s*/u, "");
}

/**
 * Tracked, uppercase kicker line centered at `y` that shrinks to fit and then truncates.
 * Returns the font size used.
 */
export function kicker(
  p: Paint,
  text: string,
  y: number,
  opts: { size?: number; min?: number; color?: string; spacing?: number; maxWidth?: number } = {},
): number {
  const { ctx, family } = p;
  const maxWidth = opts.maxWidth ?? CONTENT_WIDTH;
  const upper = text.toLocaleUpperCase();
  const spacingRatio = (opts.spacing ?? 6) / (opts.size ?? 44);
  let size = opts.size ?? 44;
  const min = opts.min ?? 28;
  ctx.font = font(900, size, family);
  while (size > min && trackedWidth(ctx, upper, size * spacingRatio) > maxWidth) {
    size -= 1;
    ctx.font = font(900, size, family);
  }
  let t = upper;
  if (trackedWidth(ctx, t, size * spacingRatio) > maxWidth) {
    // Approximate the tracking by padding the measure with spacing per character.
    t = truncateToWidth(upper, maxWidth, (s) => trackedWidth(ctx, s, size * spacingRatio));
  }
  ctx.save();
  ctx.fillStyle = opts.color ?? COLORS.ice;
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(56, 189, 248, 0.5)";
  ctx.shadowBlur = 18;
  trackedText(ctx, t, WIDTH / 2, y, size * spacingRatio, "center");
  ctx.restore();
  return size;
}

export function displayNameLine(p: Paint, name: string | undefined, y: number): void {
  if (!name?.trim()) return;
  const { ctx, family } = p;
  ctx.save();
  ctx.font = font(700, 36, family);
  ctx.fillStyle = COLORS.textMuted;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  fittedText(ctx, name.trim(), WIDTH / 2, y, CONTENT_WIDTH - 120);
  ctx.restore();
}

export interface Tile {
  icon: string;
  value: string;
  label: string;
  /** Color of the value text. */
  accent?: string;
  /** Relative width (default 1). */
  weight?: number;
}

/** A row of frosted stat tiles: icon, big value (wraps to 2 lines if needed), small label. */
export function statTiles(p: Paint, tiles: readonly Tile[], y: number, h: number): void {
  const { ctx, family } = p;
  const cols = columns(SAFE.side, CONTENT_WIDTH, tiles.map((t) => t.weight ?? 1), 24);
  tiles.forEach((tile, i) => {
    const c = cols[i]!;
    panel(ctx, c.x, y, c.w, h, 30);
    const cx = c.x + c.w / 2;
    const inner = c.w - 40;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    emoji(ctx, tile.icon, cx, y + 50, 46, family);

    // Value: one line as big as possible; else two lines; else truncate.
    ctx.textBaseline = "alphabetic";
    const valueY = y + h * 0.64;
    const fitted = fitFontSize(tile.value, inner, 68, 40, measureAt(ctx, 900, family));
    ctx.font = font(900, fitted, family);
    let lines = [tile.value];
    let size = fitted;
    if (ctx.measureText(tile.value).width > inner && /\s/.test(tile.value.trim())) {
      size = 34;
      ctx.font = font(900, size, family);
      lines = wrapText(tile.value, inner, 2, measureWith(ctx));
    }
    ctx.fillStyle = tile.accent ?? COLORS.text;
    ctx.shadowColor = tile.accent ?? "rgba(255,255,255,0.3)";
    ctx.shadowBlur = 12;
    if (lines.length === 1) {
      fittedText(ctx, lines[0]!, cx, valueY + (68 - size) * 0.25, inner);
    } else {
      const lh = size * 1.04;
      const first = y + 84 + size * 0.76;
      lines.forEach((l, li) => ctx.fillText(l, cx, first + li * lh));
    }
    ctx.shadowBlur = 0;

    const labelSize = fitFontSize(tile.label, inner, 26, 20, measureAt(ctx, 700, family));
    ctx.font = font(700, labelSize, family);
    ctx.fillStyle = COLORS.textMuted;
    ctx.fillText(truncateToWidth(tile.label, inner, measureWith(ctx)), cx, y + h - 28);
    ctx.restore();
  });
}

/** Seed material: same stats → same decoration. */
export function seedFor(input: ShareCardInput): string {
  if (input.seed !== undefined) return String(input.seed);
  const s = input.stats;
  return [input.kind, input.milestoneDay ?? "", s.title, s.today, s.day, s.perfectDays, s.perfectStreak, s.habits.length].join("|");
}
