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
  /**
   * Font family list (CSS syntax) for all text. Defaults to an Inter/system stack. If you load
   * a web font, it is awaited via `document.fonts` before drawing.
   */
  fontFamily?: string;
  /** Overrides the decoration seed (defaults to a hash of the stats, so output is stable). */
  seed?: string | number;
  /** Max habit rows on the story card (default 5). */
  maxHabits?: number;
}
