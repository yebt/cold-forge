import { getMessages, LOCALES, type Locale, type Messages } from "@cold-forge/i18n";
import { en, type LandingCopy } from "./en.ts";
import { es } from "./es.ts";
import { pt } from "./pt.ts";

export { LOCALES, type Locale, type LandingCopy, type Messages };

const COPY: Record<Locale, LandingCopy> = { en, es, pt };

/** Landing copy + shared app copy for a locale. */
export function useCopy(locale: Locale): { t: LandingCopy; m: Messages } {
  return { t: COPY[locale], m: getMessages(locale) };
}

/** Fills `{key}` placeholders in a template string. */
export function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
