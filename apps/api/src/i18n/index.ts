import type { Locale } from "@cold-forge/i18n";
import { en, type ApiMessages } from "./en.ts";
import { es } from "./es.ts";
import { pt } from "./pt.ts";

export type { ApiMessages };

const MESSAGES: Record<Locale, ApiMessages> = { en, es, pt };

export function apiMessages(locale: Locale): ApiMessages {
  return MESSAGES[locale] ?? en;
}
