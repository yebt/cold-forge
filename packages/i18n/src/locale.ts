export const LOCALES = ["en", "es", "pt"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Español",
  pt: "Português",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Picks the best supported locale from a list of BCP 47 tags (e.g. `navigator.languages`
 * or an `Accept-Language` header split on commas). `pt-BR` → `pt`, `es-MX` → `es`.
 */
export function detectLocale(preferred: readonly string[] | string | null | undefined): Locale {
  const tags = typeof preferred === "string" ? preferred.split(",") : (preferred ?? []);
  for (const tag of tags) {
    const base = tag.trim().split(";")[0]!.split("-")[0]!.toLowerCase();
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}
