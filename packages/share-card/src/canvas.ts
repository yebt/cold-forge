/** Canvas creation + PNG export, preferring OffscreenCanvas. */

import type { Ctx } from "./draw.ts";

export interface Surface {
  ctx: Ctx;
  toBlob(): Promise<Blob>;
}

export function createSurface(width: number, height: number): Surface {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (ctx) return { ctx, toBlob: () => canvas.convertToBlob({ type: "image/png" }) };
  }
  if (typeof document === "undefined") {
    throw new Error("renderShareCard needs a browser (OffscreenCanvas or document) to draw.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("renderShareCard: 2D canvas context unavailable.");
  return {
    ctx,
    toBlob: () =>
      new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas.toBlob returned null"))), "image/png"),
      ),
  };
}

/** Waits for the given font family (if it's a loaded/loadable web font) before drawing. */
export async function ensureFonts(family: string): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load(`900 100px ${family}`, "0123456789"),
      document.fonts.load(`700 40px ${family}`, "Aa"),
    ]);
  } catch {
    // Missing web fonts just fall back to system fonts.
  }
}
