/**
 * Text fitting helpers. They take a `measure` function instead of a canvas so they can be
 * unit-tested; on a canvas pass `(s) => ctx.measureText(s).width` after setting `ctx.font`.
 */

export type Measure = (text: string) => number;

export const ELLIPSIS = "…";

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/** Splits into user-perceived characters so emoji / accents are never cut in half. */
export function graphemes(text: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(text), (s) => s.segment);
  return Array.from(text);
}

/** Returns `text` unchanged when it fits, otherwise the longest prefix + "…" that fits. */
export function truncateToWidth(text: string, maxWidth: number, measure: Measure): string {
  if (measure(text) <= maxWidth) return text;
  const chars = graphemes(text);
  let lo = 0;
  let hi = chars.length;
  // Largest n such that chars[0..n] + "…" fits.
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(chars.slice(0, mid).join("").trimEnd() + ELLIPSIS) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  if (lo === 0) return measure(ELLIPSIS) <= maxWidth ? ELLIPSIS : "";
  return chars.slice(0, lo).join("").trimEnd() + ELLIPSIS;
}

/**
 * Biggest font size in [minSize, maxSize] at which `text` fits in `maxWidth`.
 * `measureAt(size)` returns a measure function for that size. Falls back to `minSize`.
 */
export function fitFontSize(
  text: string,
  maxWidth: number,
  maxSize: number,
  minSize: number,
  measureAt: (size: number) => Measure,
): number {
  if (measureAt(maxSize)(text) <= maxWidth) return maxSize;
  // Width scales ~linearly with size, so jump straight to the estimate, then step down.
  const width = measureAt(maxSize)(text);
  let size = Math.floor((maxSize * maxWidth) / width);
  size = Math.min(Math.max(size, minSize), maxSize);
  while (size > minSize && measureAt(size)(text) > maxWidth) size -= 1;
  return size;
}

/**
 * Greedy word wrap into at most `maxLines` lines; the last line is truncated with "…"
 * if the text doesn't fit. Words longer than a line are truncated too.
 */
export function wrapText(text: string, maxWidth: number, maxLines: number, measure: Measure): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || maxLines <= 0) return [];
  const lines: string[] = [];
  let start = 0; // index of the first word on the current line
  for (let i = 0; i < words.length; i++) {
    if (lines.length === maxLines - 1) break; // last line takes whatever is left
    const candidate = words.slice(start, i + 1).join(" ");
    if (i > start && measure(candidate) > maxWidth) {
      lines.push(words.slice(start, i).join(" "));
      start = i;
    }
  }
  lines.push(words.slice(start).join(" "));
  return lines.map((l) => truncateToWidth(l, maxWidth, measure));
}

/**
 * Splits a localized label around a number so the number can be drawn huge, e.g.
 * "Día 23/92" → { prefix: "Día", number: "23", suffix: "/92" } with `needle = "23/92"`.
 * Returns null when the needle can't be found (then draw the label as-is).
 */
export function splitLabel(
  label: string,
  needle: string,
  number: string,
): { prefix: string; number: string; suffix: string } | null {
  const at = label.lastIndexOf(needle);
  if (at < 0 || !needle.startsWith(number)) return null;
  return {
    prefix: label.slice(0, at).trim(),
    number,
    suffix: label.slice(at + number.length).trimEnd(),
  };
}

/** `splitLabel` for the `m.stats.day(day, total)` label. */
export function splitDayLabel(label: string, day: number, total: number) {
  return splitLabel(label, `${day}/${total}`, String(day));
}
