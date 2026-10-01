import { createSurface, ensureFonts } from "./canvas.ts";
import { paintMilestone } from "./cards/milestone.ts";
import { seedFor } from "./cards/common.ts";
import { paintStory } from "./cards/story.ts";
import { createRng } from "./rng.ts";
import { DEFAULT_FONT_STACK, HEIGHT, SAFE, WIDTH, fontStack } from "./theme.ts";
import type { ShareCardInput } from "./types.ts";

export type { ShareCardInput, ShareCardKind } from "./types.ts";
export { computeHeatmap, heatmapLevel, type HeatmapCell } from "./heatmap.ts";

/** 9:16 story size (Instagram / TikTok / WhatsApp status). */
export const STORY_WIDTH = WIDTH;
export const STORY_HEIGHT = HEIGHT;
/** Area not covered by Instagram's story UI; important content stays inside it. */
export const STORY_SAFE_ZONE = SAFE;
export { DEFAULT_FONT_STACK };

/** Renders a share card into a PNG Blob. Browser-only (uses canvas). */
export async function renderShareCard(input: ShareCardInput): Promise<Blob> {
  if (input.kind === "milestone" && input.milestoneDay === undefined) {
    // Fall back gracefully rather than throwing in the middle of a share flow.
    input = { ...input, milestoneDay: input.stats.day };
  }
  const family = fontStack(input.fontFamily ?? DEFAULT_FONT_STACK);
  await ensureFonts(input.fontFamily ?? DEFAULT_FONT_STACK);

  const surface = createSurface(WIDTH, HEIGHT);
  const paint = { ctx: surface.ctx, rng: createRng(seedFor(input)), family };
  if (input.kind === "milestone") paintMilestone(paint, input);
  else paintStory(paint, input);
  return surface.toBlob();
}
