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

/**
 * Cuts `value` to at most `max` UTF-16 code units (what the sync API and the Firestore rules'
 * `string.size()` limit, and what `<input maxLength>` counts) without splitting a character:
 * whole user-perceived characters (graphemes) are kept or dropped together.
 */
export function truncateUnits(value: string, max: number): string {
  if (value.length <= max) return value;
  const Seg = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  const parts = Seg ? Array.from(new Seg(undefined, { granularity: "grapheme" }).segment(value), (s) => s.segment) : Array.from(value);
  let out = "";
  for (const p of parts) {
    if (out.length + p.length > max) break;
    out += p;
  }
  return out;
}

/**
 * Normalizes user-typed text before it is stored: replaces lone surrogates, strips invisible /
 * control / bidi characters, trims zalgo stacks, collapses line breaks unless `multiline`, trims,
 * and caps the length in UTF-16 units.
 */
export function cleanText(value: string, max: number, multiline = false): string {
  let v = value.toWellFormed().replace(UNSAFE_TEXT_G, "").replace(COMBINING_RUN_G, "$1");
  if (!multiline) v = v.replace(/[\t\n]+/g, " ");
  v = v.trim();
  return v.length > max ? truncateUnits(v, max).trim() : v;
}
