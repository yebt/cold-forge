/** Canvas drawing primitives shared by the card painters. */

import type { Rng } from "./rng.ts";
import { COLORS, HEIGHT, WIDTH, font } from "./theme.ts";
import { graphemes, truncateToWidth, type Measure } from "./text.ts";

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Everything a painter needs besides the input. */
export interface Paint {
  ctx: Ctx;
  rng: Rng;
  family: string;
}

export function measureWith(ctx: Ctx): Measure {
  return (s) => ctx.measureText(s).width;
}

/** Measure function for a given font, restoring nothing (callers set the font they draw with). */
export function measureAt(ctx: Ctx, weight: number, family: string): (size: number) => Measure {
  return (size) => {
    ctx.font = font(weight, size, family);
    return measureWith(ctx);
  };
}

export function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Background

export function drawBackground(p: Paint, opts: { emberStrength?: number; iceStrength?: number } = {}): void {
  const { ctx } = p;
  const ember = opts.emberStrength ?? 1;
  const ice = opts.iceStrength ?? 1;

  const base = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  base.addColorStop(0, COLORS.night);
  base.addColorStop(0.55, COLORS.nightMid);
  base.addColorStop(1, COLORS.nightHigh);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Cold aurora up top.
  radialGlow(ctx, WIDTH * 0.82, HEIGHT * 0.12, 900, `rgba(56, 189, 248, ${0.22 * ice})`);
  radialGlow(ctx, WIDTH * 0.1, HEIGHT * 0.32, 700, `rgba(125, 211, 252, ${0.08 * ice})`);
  // Forge heat from below.
  radialGlow(ctx, WIDTH * 0.2, HEIGHT * 1.02, 1000, `rgba(249, 115, 22, ${0.26 * ember})`);
  radialGlow(ctx, WIDTH * 0.95, HEIGHT * 0.9, 600, `rgba(194, 65, 12, ${0.16 * ember})`);
}

export function radialGlow(ctx: Ctx, x: number, y: number, r: number, color: string): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** Fine frost grain: thousands of faint specks. */
export function drawFrost(p: Paint, count = 2600): void {
  const { ctx, rng } = p;
  ctx.save();
  for (let i = 0; i < count; i++) {
    const x = rng.range(0, WIDTH);
    const y = rng.range(0, HEIGHT);
    // Frost settles more at the top of the image.
    const a = rng.range(0.02, 0.09) * (1.2 - y / HEIGHT);
    ctx.fillStyle = `rgba(224, 242, 254, ${a.toFixed(3)})`;
    const s = rng.chance(0.06) ? 2.4 : 1.4;
    ctx.fillRect(x, y, s, s);
  }
  ctx.restore();
}

/** Branching ice-crack lines creeping in from the edges. */
export function drawIceCracks(p: Paint, count = 6): void {
  const { ctx, rng } = p;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let i = 0; i < count; i++) {
    const edge = rng.int(0, 3);
    const along = rng.range(0.05, 0.95);
    const x = edge === 0 ? along * WIDTH : edge === 1 ? WIDTH : edge === 2 ? along * WIDTH : 0;
    const y = edge === 0 ? 0 : edge === 1 ? along * HEIGHT * 0.6 : edge === 2 ? HEIGHT : along * HEIGHT * 0.6;
    // Head roughly towards the center.
    const angle = Math.atan2(HEIGHT * 0.4 - y, WIDTH / 2 - x) + rng.range(-0.6, 0.6);
    crack(ctx, rng, x, y, angle, rng.range(180, 380), 3.2, 0);
  }
  ctx.restore();
}

function crack(ctx: Ctx, rng: Rng, x: number, y: number, angle: number, length: number, width: number, depth: number): void {
  const steps = Math.max(3, Math.round(length / 28));
  ctx.strokeStyle = `rgba(186, 230, 253, ${(0.16 - depth * 0.04).toFixed(3)})`;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let s = 0; s < steps; s++) {
    angle += rng.range(-0.45, 0.45);
    const seg = length / steps;
    x += Math.cos(angle) * seg;
    y += Math.sin(angle) * seg;
    ctx.lineTo(x, y);
    if (depth < 2 && rng.chance(0.22)) {
      ctx.stroke();
      crack(ctx, rng, x, y, angle + rng.pick([-1, 1]) * rng.range(0.5, 1.1), length * 0.45, width * 0.6, depth + 1);
      ctx.strokeStyle = `rgba(186, 230, 253, ${(0.16 - depth * 0.04).toFixed(3)})`;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x, y);
    }
  }
  ctx.stroke();
}

/** Glowing ember sparks drifting up from the bottom of the card. */
export function drawSparks(p: Paint, count = 70, opts: { top?: number; hot?: boolean } = {}): void {
  const { ctx, rng } = p;
  const top = opts.top ?? HEIGHT * 0.45;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < count; i++) {
    // Bias towards the bottom: squared distribution.
    const t = rng.next() ** 1.8;
    const y = HEIGHT - t * (HEIGHT - top);
    const x = rng.range(0, WIDTH);
    const r = rng.range(1.2, opts.hot ? 5 : 3.8) * (1 - t * 0.5);
    const a = rng.range(0.35, 0.95) * (1 - t * 0.6);
    radialGlow(ctx, x, y, r * 6, `rgba(249, 115, 22, ${(a * 0.35).toFixed(3)})`);
    ctx.fillStyle = `rgba(253, 186, 116, ${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    // A short motion trail for some of them.
    if (rng.chance(0.35)) {
      const len = rng.range(10, 34);
      const drift = rng.range(-8, 8);
      const g = ctx.createLinearGradient(x, y, x - drift, y + len);
      g.addColorStop(0, `rgba(253, 186, 116, ${(a * 0.6).toFixed(3)})`);
      g.addColorStop(1, "rgba(249, 115, 22, 0)");
      ctx.strokeStyle = g;
      ctx.lineWidth = r * 0.9;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - drift, y + len);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Small six-armed snowflakes scattered in the upper half. */
export function drawSnowflakes(p: Paint, count = 10): void {
  const { ctx, rng } = p;
  ctx.save();
  for (let i = 0; i < count; i++) {
    const x = rng.range(40, WIDTH - 40);
    const y = rng.range(40, HEIGHT * 0.55);
    const r = rng.range(6, 18);
    snowflake(ctx, x, y, r, rng.range(0, Math.PI), `rgba(186, 230, 253, ${rng.range(0.08, 0.22).toFixed(3)})`);
  }
  ctx.restore();
}

export function snowflake(ctx: Ctx, x: number, y: number, r: number, rot: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.2, r / 8);
  ctx.lineCap = "round";
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -r);
    ctx.moveTo(0, -r * 0.55);
    ctx.lineTo(r * 0.22, -r * 0.75);
    ctx.moveTo(0, -r * 0.55);
    ctx.lineTo(-r * 0.22, -r * 0.75);
    ctx.stroke();
  }
  ctx.restore();
}

/** Soft dark vignette so edges recede and text pops. */
export function drawVignette(ctx: Ctx): void {
  const g = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, HEIGHT * 0.35, WIDTH / 2, HEIGHT / 2, HEIGHT * 0.75);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(2, 4, 8, 0.55)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

// ---------------------------------------------------------------------------
// Text

export type Align = "left" | "center" | "right";

/** Draws text with manual letter spacing (ctx.letterSpacing isn't available everywhere). */
export function trackedText(ctx: Ctx, text: string, x: number, y: number, spacing: number, align: Align = "left"): number {
  const chars = graphemes(text);
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * Math.max(0, chars.length - 1);
  let cx = align === "left" ? x : align === "center" ? x - total / 2 : x - total;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = "left";
  chars.forEach((c, i) => {
    ctx.fillText(c, cx, y);
    cx += widths[i]! + spacing;
  });
  ctx.textAlign = prevAlign;
  return total;
}

export function trackedWidth(ctx: Ctx, text: string, spacing: number): number {
  const chars = graphemes(text);
  return chars.reduce((sum, c) => sum + ctx.measureText(c).width, 0) + spacing * Math.max(0, chars.length - 1);
}

/** Truncates `text` for the current font and draws it. Returns the drawn width. */
export function fittedText(ctx: Ctx, text: string, x: number, y: number, maxWidth: number): number {
  const t = truncateToWidth(text, maxWidth, measureWith(ctx));
  ctx.fillText(t, x, y);
  return ctx.measureText(t).width;
}

/** Fill text with a soft glow behind it. */
export function glowText(ctx: Ctx, text: string, x: number, y: number, color: string, blur: number, fill: string | CanvasGradient): void {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = blur / 3;
  ctx.fillText(text, x, y);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Widgets

export function panel(ctx: Ctx, x: number, y: number, w: number, h: number, r = 28, stroke: string = COLORS.panelStroke): void {
  ctx.save();
  roundRectPath(ctx, x, y, w, h, r);
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, "rgba(125, 211, 252, 0.09)");
  g.addColorStop(1, "rgba(15, 30, 55, 0.35)");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  // Frosted top highlight.
  ctx.beginPath();
  ctx.moveTo(x + r, y + 1.5);
  ctx.lineTo(x + w - r, y + 1.5);
  ctx.strokeStyle = "rgba(224, 242, 254, 0.22)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/** Ice → ember progress bar with a glowing leading edge. */
export function progressBar(ctx: Ctx, x: number, y: number, w: number, h: number, fraction: number): void {
  const f = Math.min(Math.max(fraction, 0), 1);
  ctx.save();
  roundRectPath(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = "rgba(125, 211, 252, 0.10)";
  ctx.fill();
  ctx.strokeStyle = "rgba(125, 211, 252, 0.22)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Week ticks so the bar reads as "time".
  ctx.fillStyle = "rgba(224, 242, 254, 0.12)";
  for (let i = 1; i < 13; i++) {
    const tx = x + (w * i) / 13;
    ctx.fillRect(tx - 1, y + h * 0.3, 2, h * 0.4);
  }

  if (f > 0) {
    const fw = Math.max(h, w * f);
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, COLORS.iceDeep);
    g.addColorStop(0.55, COLORS.ice);
    g.addColorStop(0.8, COLORS.emberHot);
    g.addColorStop(1, COLORS.ember);
    ctx.shadowColor = "rgba(56, 189, 248, 0.6)";
    ctx.shadowBlur = 24;
    roundRectPath(ctx, x, y, fw, h, h / 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowBlur = 0;
    // Glossy highlight.
    roundRectPath(ctx, x + 4, y + 3, fw - 8, h * 0.32, h * 0.16);
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.fill();
    // Hot spark at the leading edge.
    const ex = x + fw - h / 2;
    radialGlow(ctx, ex, y + h / 2, h * 2.2, "rgba(253, 186, 116, 0.55)");
    ctx.fillStyle = "#FFF7ED";
    ctx.beginPath();
    ctx.arc(ex, y + h / 2, h * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Rounded pill with text, centered on `cx`. Returns its rect. */
export function pill(
  ctx: Ctx,
  text: string,
  cx: number,
  y: number,
  opts: { size: number; family: string; weight?: number; padX?: number; h?: number; maxWidth: number; color?: string; fill?: string; stroke?: string },
): { x: number; w: number } {
  const h = opts.h ?? opts.size * 1.9;
  const padX = opts.padX ?? opts.size * 0.9;
  ctx.font = font(opts.weight ?? 800, opts.size, opts.family);
  const t = truncateToWidth(text, opts.maxWidth - padX * 2, measureWith(ctx));
  const tw = ctx.measureText(t).width;
  const w = tw + padX * 2;
  const x = cx - w / 2;
  ctx.save();
  roundRectPath(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = opts.fill ?? "rgba(125, 211, 252, 0.10)";
  ctx.fill();
  ctx.strokeStyle = opts.stroke ?? "rgba(125, 211, 252, 0.35)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = opts.color ?? COLORS.iceFrost;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(t, cx, y + h / 2 + opts.size * 0.04);
  ctx.restore();
  return { x, w };
}

/** Footer brand line; sits in the IG-covered zone on purpose (decorative). */
export function footer(p: Paint, y: number, brand = "COLD FORGE", tag = "#WinterArc"): void {
  const { ctx } = p;
  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const sep = "   ·   ";
  ctx.font = font(900, 34, p.family);
  const brandW = trackedWidth(ctx, brand, 7);
  ctx.font = font(800, 34, p.family);
  const restW = ctx.measureText(sep + tag).width;
  const w = brandW + restW;
  const sx = WIDTH / 2 - w / 2;
  snowflake(ctx, sx - 42, y - 12, 15, 0, "rgba(125, 211, 252, 0.85)");
  snowflake(ctx, sx + w + 42, y - 12, 15, 0.3, "rgba(249, 115, 22, 0.85)");
  ctx.font = font(900, 34, p.family);
  ctx.fillStyle = "rgba(224, 242, 254, 0.85)";
  trackedText(ctx, brand, sx, y, 7, "left");
  ctx.font = font(800, 34, p.family);
  ctx.fillStyle = "rgba(253, 186, 116, 0.85)";
  ctx.fillText(sep + tag, sx + brandW, y);
  ctx.restore();
}

/**
 * Draws an emoji. Chrome multiplies color-emoji glyphs by the fill alpha, so force an opaque fill.
 */
export function emoji(ctx: Ctx, glyph: string, x: number, y: number, size: number, family: string, alpha = 1): void {
  ctx.save();
  ctx.font = font(400, size, family);
  ctx.fillStyle = "#ffffff";
  ctx.globalAlpha = alpha;
  ctx.fillText(glyph, x, y);
  ctx.restore();
}
