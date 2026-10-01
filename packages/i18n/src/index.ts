import { en, type Messages } from "./en.ts";
import { es } from "./es.ts";
import type { Locale } from "./locale.ts";
import { pt } from "./pt.ts";

export * from "./locale.ts";
export { buildMilestoneShareText, buildShareText } from "./share.ts";
export type { Messages };

export const MESSAGES: Record<Locale, Messages> = { en, es, pt };

export function getMessages(locale: Locale): Messages {
  return MESSAGES[locale];
}
