import { getMessages, type Locale, type Messages } from "@cold-forge/i18n";
import { en, type UiMessages } from "./en.ts";
import { es } from "./es.ts";
import { pt } from "./pt.ts";

export type { UiMessages };

export const UI_MESSAGES: Record<Locale, UiMessages> = { en, es, pt };

export interface Translations {
  locale: Locale;
  /** App UI copy. */
  ui: UiMessages;
  /** Shared domain copy (ranks, habit templates, stats, milestones, share text). */
  m: Messages;
}

export function getTranslations(locale: Locale): Translations {
  return { locale, ui: UI_MESSAGES[locale], m: getMessages(locale) };
}

/** Short localized date, e.g. "Dec 31" / "31 dic". */
export function formatShortDate(date: string, locale: Locale): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString(locale === "pt" ? "pt-BR" : locale === "es" ? "es-419" : "en-US", {
    month: "short",
    day: "numeric",
  });
}
