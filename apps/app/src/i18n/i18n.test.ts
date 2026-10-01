import { expect, test } from "bun:test";
import { UI_MESSAGES } from "./index.ts";

/** Type-checking already enforces the shape; this guards against empty strings sneaking in. */
test("every locale has non-empty copy for every key", () => {
  const walk = (v: unknown, path: string): void => {
    if (typeof v === "string") expect(v.trim().length, path).toBeGreaterThan(0);
    else if (typeof v === "function") expect(String((v as (...a: number[]) => unknown)(3, 5)).length, path).toBeGreaterThan(0);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  for (const [locale, ui] of Object.entries(UI_MESSAGES)) walk(ui, locale);
});
