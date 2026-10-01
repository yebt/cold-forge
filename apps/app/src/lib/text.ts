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

/**
 * Characters the sync API rejects in user text (kept in step with `@cold-forge/sync`): C0/C1
 * controls except tab/newline, soft hyphen, zero-width chars and directional marks, line/paragraph
 * separators, bidi embeddings/overrides/isolates, invisible operators, BOM, Arabic letter mark,
 * Mongolian vowel separator and tag characters.
 */
export const UNSAFE_TEXT =
  /[\x00-\x08\x0b-\x1f\x7f-\x9f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u{e0000}-\u{e007f}]/u;
const UNSAFE_TEXT_G = new RegExp(UNSAFE_TEXT.source, "gu");
/** Runs of 4+ combining marks ("zalgo") are rejected by the API; keep at most 3. */
const COMBINING_RUN_G = /(\p{M}{3})\p{M}+/gu;

/** Length in code points (what the sync API limits), not UTF-16 units. */
export function codePointLength(value: string): number {
  let n = 0;
  for (const _ of value) n++;
  return n;
}

/**
 * Normalizes user-typed text before it is stored: replaces lone surrogates, strips invisible /
 * control / bidi characters, trims zalgo stacks, collapses line breaks unless `multiline`, trims,
 * and caps the length in code points.
 */
export function cleanText(value: string, max: number, multiline = false): string {
  let v = value.toWellFormed().replace(UNSAFE_TEXT_G, "").replace(COMBINING_RUN_G, "$1");
  if (!multiline) v = v.replace(/[\t\n]+/g, " ");
  v = v.trim();
  return codePointLength(v) > max ? Array.from(v).slice(0, max).join("").trim() : v;
}
