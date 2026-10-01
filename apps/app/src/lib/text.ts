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
