import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export async function hapticImpact(): Promise<void> {
  try {
    await Haptics.impact({ style: ImpactStyle.Medium });
  } catch {
    /* not supported */
  }
}

export async function hapticSuccess(): Promise<void> {
  try {
    await Haptics.notification({ type: NotificationType.Success });
  } catch {
    /* not supported */
  }
}

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor =
    globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

/** Inharmonic partials of a struck steel bar, relative to the fundamental. */
const PARTIALS = [1, 2.76, 5.4, 8.93];

/** One synthesized anvil strike: a noise "thwack" plus ringing metallic partials. */
function strike(ac: AudioContext, when: number, base: number, gain: number): void {
  const out = ac.createGain();
  out.gain.value = gain;
  out.connect(ac.destination);

  // Short filtered noise burst for the hammer impact.
  const len = Math.floor(ac.sampleRate * 0.05);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const noise = ac.createBufferSource();
  noise.buffer = buf;
  const hp = ac.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 1800;
  const ng = ac.createGain();
  ng.gain.value = 0.5;
  noise.connect(hp).connect(ng).connect(out);
  noise.start(when);

  PARTIALS.forEach((ratio, i) => {
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.value = base * ratio;
    const g = ac.createGain();
    const peak = 0.35 / (i + 1);
    const decay = 0.6 / (i * 0.6 + 1);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(peak, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    osc.connect(g).connect(out);
    osc.start(when);
    osc.stop(when + decay + 0.05);
  });
}

export function playClang(): void {
  const ac = audio();
  if (!ac) return;
  void ac.resume?.();
  strike(ac, ac.currentTime + 0.005, 620 + Math.random() * 60, 0.5);
}

/** Three rising strikes for a perfect day. */
export function playFanfare(): void {
  const ac = audio();
  if (!ac) return;
  void ac.resume?.();
  const t = ac.currentTime + 0.01;
  [520, 660, 880].forEach((f, i) => strike(ac, t + i * 0.13, f, 0.45));
}
