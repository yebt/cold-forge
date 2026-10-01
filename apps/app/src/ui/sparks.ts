import { prefersReducedMotion } from "../platform/feedback.ts";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

const EMBER = ["#fff7d6", "#fde68a", "#fbbf24", "#f97316", "#fb923c"];
const ICE = ["#e0f2fe", "#7dd3fc", "#38bdf8"];

let canvas: HTMLCanvasElement | null = null;
let ctx2d: CanvasRenderingContext2D | null = null;
let particles: Particle[] = [];
let frame = 0;
let last = 0;

function ensureCanvas(): CanvasRenderingContext2D | null {
  if (ctx2d && canvas?.isConnected) return ctx2d;
  canvas = document.createElement("canvas");
  canvas.className = "sparks-canvas";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  ctx2d = canvas.getContext("2d");
  resize();
  addEventListener("resize", resize);
  return ctx2d;
}

function resize(): void {
  if (!canvas) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx2d?.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function tick(t: number): void {
  const ctx = ctx2d;
  if (!ctx) return;
  const dt = Math.min((t - last) / 1000, 0.05);
  last = t;
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  particles = particles.filter((p) => {
    p.life -= dt;
    if (p.life <= 0) return false;
    p.vy += 900 * dt; // gravity
    p.vx *= 1 - 1.6 * dt; // air drag
    p.vy *= 1 - 1.6 * dt;
    const px = p.x;
    const py = p.y;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const k = p.life / p.maxLife;
    ctx.strokeStyle = p.color;
    ctx.globalAlpha = Math.min(1, k * 1.6);
    ctx.lineWidth = p.size * (0.4 + k * 0.6);
    ctx.beginPath();
    ctx.moveTo(px - (p.x - px) * 1.5, py - (p.y - py) * 1.5);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    return true;
  });
  ctx.globalAlpha = 1;
  if (particles.length > 0) frame = requestAnimationFrame(tick);
  else {
    frame = 0;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
  }
}

export interface BurstOptions {
  count?: number;
  power?: number;
  /** Mix in icy sparks. */
  ice?: boolean;
}

/** Spark burst from a viewport point (e.g. the center of the tapped button). */
export function burst(x: number, y: number, { count = 28, power = 1, ice = false }: BurstOptions = {}): void {
  if (prefersReducedMotion()) return;
  if (!ensureCanvas()) return;
  for (let i = 0; i < count; i++) {
    // Mostly upward fan, like sparks off an anvil.
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5;
    const speed = (250 + Math.random() * 450) * power;
    const palette = ice && Math.random() < 0.35 ? ICE : EMBER;
    const life = 0.35 + Math.random() * 0.5;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life,
      maxLife: life,
      size: 1.5 + Math.random() * 2.2,
      color: palette[Math.floor(Math.random() * palette.length)]!,
    });
  }
  if (!frame) {
    last = performance.now();
    frame = requestAnimationFrame(tick);
  }
}

export function burstFromElement(el: Element, options?: BurstOptions): void {
  const r = el.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top + r.height / 2, options);
}

/** Perfect day: several bursts across the screen. */
export function celebrate(): void {
  if (prefersReducedMotion()) return;
  const w = innerWidth;
  const h = innerHeight;
  const points: [number, number][] = [
    [w * 0.5, h * 0.45],
    [w * 0.2, h * 0.6],
    [w * 0.8, h * 0.6],
    [w * 0.35, h * 0.3],
    [w * 0.65, h * 0.3],
  ];
  points.forEach(([x, y], i) => setTimeout(() => burst(x, y, { count: 50, power: 1.3, ice: true }), i * 140));
}
