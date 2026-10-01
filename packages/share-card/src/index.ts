import type { ArcStats, CheckIn, ISODate } from "@cold-forge/core";
import type { Messages } from "@cold-forge/i18n";

export type ShareCardKind = "story" | "milestone";

export interface ShareCardInput {
  kind: ShareCardKind;
  stats: ArcStats;
  /** Check-ins for the arc, used to draw the mini heatmap. */
  checkIns: readonly CheckIn[];
  arc: { startDate: ISODate; endDate: ISODate };
  messages: Messages;
  /** Required when `kind === "milestone"`: one of `MILESTONE_DAYS`. */
  milestoneDay?: number;
  /** Optional @handle or display name printed on the card. */
  displayName?: string;
}

/** 9:16 story size (Instagram / TikTok / WhatsApp status). */
export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;

/** Renders a share card into a PNG Blob. Browser-only (uses canvas). */
export async function renderShareCard(input: ShareCardInput): Promise<Blob> {
  void input;
  throw new Error("renderShareCard: not implemented yet");
}
