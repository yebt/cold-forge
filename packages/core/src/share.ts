const BAR_WIDTH = 10;

export function progressBar(fraction: number, width = BAR_WIDTH): string {
  const filled = Math.round(Math.min(Math.max(fraction, 0), 1) * width);
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}
