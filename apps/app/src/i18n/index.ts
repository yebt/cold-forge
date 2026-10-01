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

/** BCP 47 tag used for Intl formatting. */
export function localeTag(locale: Locale): string {
  return locale === "pt" ? "pt-BR" : locale === "es" ? "es-419" : "en-US";
}

/** "2 minutes ago" / "hace 2 minutos" / "há 2 minutos"; `justNow` under a minute. */
export function formatAgo(iso: string, nowMs: number, locale: Locale, justNow: string): string {
  const diff = Math.max(0, nowMs - Date.parse(iso));
  if (!Number.isFinite(diff) || diff < 60_000) return justNow;
  const rtf = new Intl.RelativeTimeFormat(localeTag(locale), { numeric: "auto" });
  if (diff < 3_600_000) return rtf.format(-Math.floor(diff / 60_000), "minute");
  if (diff < 86_400_000) return rtf.format(-Math.floor(diff / 3_600_000), "hour");
  return rtf.format(-Math.floor(diff / 86_400_000), "day");
}
