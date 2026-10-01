import { ARC_DAYS } from "@cold-forge/core";

/** 0 = not lived yet, 1 = cold (missed), 2 = warm (some habits), 3 = white-hot (perfect day). */
export type HeatLevel = 0 | 1 | 2 | 3;

/**
 * Deterministic, illustrative heat levels for a 92-day heatmap mock.
 * Days after `upTo` are 0. Same output on every build.
 */
export function mockHeat(upTo: number, seed = 7): HeatLevel[] {
  let s = seed;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  return Array.from({ length: ARC_DAYS }, (_, i): HeatLevel => {
    if (i >= upTo) return 0;
    const r = rand();
    return r > 0.9 ? 1 : r > 0.68 ? 2 : 3;
  });
}
