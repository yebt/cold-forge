/** First user-perceived character (so "👍🏽" or "🏋️‍♀️" stays whole), used for emoji inputs. */
export function firstGrapheme(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const Seg = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Seg) {
    for (const { segment } of new Seg(undefined, { granularity: "grapheme" }).segment(trimmed)) return segment;
  }
  return Array.from(trimmed)[0] ?? "";
}

/** C0/C1 controls (except tab/newline) and bidi overrides/isolates: invisible, and enable spoofing. */
export const UNSAFE_TEXT = /[\x00-\x08\x0b-\x1f\x7f-\x9f‪-‮⁦-⁩]/;
const UNSAFE_TEXT_G = new RegExp(UNSAFE_TEXT.source, "g");

/** Length in code points (what the sync API limits), not UTF-16 units. */
export function codePointLength(value: string): number {
  let n = 0;
  for (const _ of value) n++;
  return n;
}

/**
 * Normalizes user-typed text before it is stored: strips control/bidi characters, collapses
 * line breaks unless `multiline`, trims, and caps the length in code points.
 */
export function cleanText(value: string, max: number, multiline = false): string {
  let v = value.replace(UNSAFE_TEXT_G, "");
  if (!multiline) v = v.replace(/[\t\n]+/g, " ");
  v = v.trim();
  return codePointLength(v) > max ? Array.from(v).slice(0, max).join("").trim() : v;
}
