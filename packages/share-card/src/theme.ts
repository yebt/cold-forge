/** Visual tokens shared by every card. */

export const WIDTH = 1080;
export const HEIGHT = 1920;

/**
 * Instagram / TikTok cover roughly the top 250px (progress bars, profile row) and the
 * bottom 300px (reply bar, captions) of a story. Anything that matters stays in between.
 */
export const SAFE = {
  top: 250,
  bottom: HEIGHT - 300,
  side: 80,
} as const;

export const CONTENT_WIDTH = WIDTH - SAFE.side * 2;

export const COLORS = {
  night: "#070b12",
  nightMid: "#0b1424",
  nightHigh: "#10203a",
  ice: "#7DD3FC",
  iceDeep: "#38BDF8",
  iceFrost: "#E0F2FE",
  ember: "#F97316",
  emberHot: "#FDBA74",
  emberDeep: "#C2410C",
  gold: "#FCD34D",
  text: "#F8FAFC",
  textMuted: "#94A3B8",
  textDim: "#475569",
  panel: "rgba(148, 197, 255, 0.06)",
  panelStroke: "rgba(125, 211, 252, 0.18)",
} as const;

export const DEFAULT_FONT_STACK =
  '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Appended to every font so emoji use the platform color emoji font. */
export const EMOJI_FONTS = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla"';

export function fontStack(family: string = DEFAULT_FONT_STACK): string {
  return `${family}, ${EMOJI_FONTS}`;
}

/** Builds a canvas `font` shorthand. */
export function font(weight: number, size: number, family: string): string {
  return `${weight} ${Math.round(size)}px ${family}`;
}
