/** Tiny deterministic RNG so the same stats always produce the same image. */

/** 32-bit FNV-1a hash of a string. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Float in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** True with probability `p`. */
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
}

/** mulberry32: fast, good enough for procedural decoration. */
export function createRng(seed: number | string): Rng {
  let state = (typeof seed === "string" ? hashString(seed) : seed) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error("pick() from empty list");
      return items[Math.floor(next() * items.length)]!;
    },
  };
}
