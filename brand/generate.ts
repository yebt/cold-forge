/**
 * Generates every raster brand asset from the SVG sources in this folder.
 *
 *   bun brand/generate.ts
 *
 * Sources (hand-written): `brand/logo.svg` (tile + mark, the mark lives in `<g id="cf-mark">`)
 * and `brand/logo-mono.svg` (single-colour mark, `currentColor`).
 * Generated: `brand/logo-wordmark.svg` (text converted to paths, no font needed to view it),
 * favicons, PWA icons, OG images per locale, and the Capacitor asset sources in `apps/app/assets`.
 *
 * Rendering uses @resvg/resvg-js with the Inter TTFs from @expo-google-fonts/inter, and all text is
 * converted to outlines with opentype.js, so the output does not depend on system fonts.
 * The tools are devDependencies of `@cold-forge/app`, resolved from there.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getMessages, LOCALES, type Locale } from "../packages/i18n/src/index.ts";
import { en as landingEn } from "../apps/landing/src/i18n/en.ts";
import { es as landingEs } from "../apps/landing/src/i18n/es.ts";
import { pt as landingPt } from "../apps/landing/src/i18n/pt.ts";

const ROOT = join(import.meta.dir, "..");
const APP = join(ROOT, "apps/app");
const LANDING = join(ROOT, "apps/landing");
const resolveFromApp = (spec: string) => Bun.resolveSync(spec, APP);

const { Resvg } = (await import(resolveFromApp("@resvg/resvg-js"))) as typeof import("@resvg/resvg-js");
const opentype = (await import(resolveFromApp("opentype.js"))).default as {
  parse(buffer: ArrayBuffer): OtFont;
};
interface OtPath {
  toPathData(decimals?: number): string;
}
interface OtFont {
  getPath(text: string, x: number, y: number, size: number, options?: { kerning?: boolean }): OtPath;
  getAdvanceWidth(text: string, size: number, options?: { kerning?: boolean }): number;
}

const fontFile = (weight: string) => join(dirname(resolveFromApp("@expo-google-fonts/inter")), weight, `Inter_${weight}.ttf`);
const loadFont = async (weight: string) => opentype.parse(await Bun.file(fontFile(weight)).arrayBuffer());
const INTER_BLACK = await loadFont("900Black");
const INTER_BOLD = await loadFont("700Bold");

export const COLORS = {
  night: "#070B12",
  panel: "#0F1724",
  ice: "#7DD3FC",
  iceStrong: "#38BDF8",
  icePale: "#E0F2FE",
  ember: "#F97316",
  emberSoft: "#FB923C",
  muted: "#94A3B8",
} as const;

// ---------------------------------------------------------------------------------------------
// SVG building blocks

const logoSvg = await Bun.file(join(import.meta.dir, "logo.svg")).text();
const monoSvg = await Bun.file(join(import.meta.dir, "logo-mono.svg")).text();

function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`brand: could not find ${start}…${end}`);
  return src.slice(a + start.length, b);
}

/** Gradients used by the mark (`cf-ice`, `cf-ember`, `cf-glow`). */
const DEFS = between(logoSvg, "<defs>", "</defs>");
/** The mark itself, in the 512×512 logo coordinate space. */
const MARK = between(logoSvg, '<g id="cf-mark">', "\n  </g>\n</svg>");
const MONO_MARK = between(monoSvg, "<title>COLD FORGE</title>", "</svg>").replaceAll("cf-mono-arm", "cf-m-arm");
/** Visual bounding box of the mark inside the 512 box (snowflake top 58 → anvil foot 432). */
const MARK_BOX = { x: 52, y: 46, w: 408, h: 386 };

/** Places the mark so its bounding box is `width` wide, centred on (cx, cy). */
function placeMark(cx: number, cy: number, width: number, mark = MARK): string {
  const k = width / MARK_BOX.w;
  const tx = cx - (MARK_BOX.x + MARK_BOX.w / 2) * k;
  const ty = cy - (MARK_BOX.y + MARK_BOX.h / 2) * k;
  return `<g transform="translate(${r(tx)} ${r(ty)}) scale(${r(k, 5)})">${mark}</g>`;
}

const r = (n: number, d = 2) => Number(n.toFixed(d));
const svgDoc = (w: number, h: number, body: string, extraDefs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><defs>${DEFS}${extraDefs}</defs>${body}</svg>`;

/** Square night background with the warm glow behind the spark. */
const fullBleed = (s: number) =>
  `<rect width="${s}" height="${s}" fill="${COLORS.night}"/><rect width="${s}" height="${s}" fill="url(#cf-glow)"/>`;

/** Icon: mark on a full-bleed square, mark width as a fraction of the side. */
const squareIcon = (s: number, markFraction: number) =>
  svgDoc(s, s, fullBleed(s) + placeMark(s / 2, s / 2, s * markFraction));

// ---------------------------------------------------------------------------------------------
// Text → outlines

interface Run {
  text: string;
  fill: string;
  font?: OtFont;
}

/** Lays out runs on one baseline with extra letter spacing (em), returning path markup and width. */
function textRuns(runs: Run[], x: number, baseline: number, size: number, tracking = 0): { svg: string; width: number } {
  let cursor = x;
  let out = "";
  const gap = tracking * size;
  runs.forEach((run, ri) => {
    const font = run.font ?? INTER_BLACK;
    const chars = [...run.text];
    let d = "";
    chars.forEach((ch, i) => {
      d += font.getPath(ch, cursor, baseline, size).toPathData(2);
      cursor += font.getAdvanceWidth(ch, size);
      const last = ri === runs.length - 1 && i === chars.length - 1;
      if (!last) cursor += gap;
    });
    if (d) out += `<path fill="${run.fill}" d="${d}"/>`;
  });
  return { svg: out, width: cursor - x };
}

function measure(text: string, size: number, font = INTER_BLACK, tracking = 0): number {
  return [...text].reduce((w, ch) => w + font.getAdvanceWidth(ch, size), 0) + Math.max(0, [...text].length - 1) * tracking * size;
}

/** Greedy word wrap by measured width. */
function wrap(text: string, size: number, maxWidth: number, font = INTER_BLACK, tracking = 0): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next, size, font, tracking) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// ---------------------------------------------------------------------------------------------
// Outputs

/** White mark on transparent: only the alpha channel is used (Android themed icons / `purpose: monochrome`). */
const monoWhite = (s: number, fraction: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}" color="#FFFFFF">${placeMark(s / 2, s / 2, s * fraction, MONO_MARK)}</svg>`;

/** `--android`: only add the themed-icon layer to apps/app/android (run after @capacitor/assets). */
const ANDROID_ONLY = process.argv.includes("--android");

const written: string[] = [];
function write(path: string, data: string | Uint8Array) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  written.push(path.slice(ROOT.length + 1));
}

function png(svg: string, width?: number): Uint8Array {
  const opts = width ? { fitTo: { mode: "width" as const, value: width } } : undefined;
  return new Resvg(svg, { ...opts, font: { loadSystemFonts: false } }).render().asPng();
}

/** ICO with PNG-compressed entries (supported by every browser that matters). */
function ico(images: { size: number; data: Uint8Array }[]): Uint8Array {
  const header = 6 + images.length * 16;
  const total = header + images.reduce((n, i) => n + i.data.length, 0);
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, images.length, true);
  let offset = header;
  images.forEach((img, i) => {
    const e = 6 + i * 16;
    view.setUint8(e, img.size >= 256 ? 0 : img.size);
    view.setUint8(e + 1, img.size >= 256 ? 0 : img.size);
    view.setUint16(e + 4, 1, true); // colour planes
    view.setUint16(e + 6, 32, true); // bits per pixel
    view.setUint32(e + 8, img.data.length, true);
    view.setUint32(e + 12, offset, true);
    buf.set(img.data, offset);
    offset += img.data.length;
  });
  return buf;
}

if (!ANDROID_ONLY) generateAll();
androidMonochrome();
console.log(`brand: wrote ${written.length} files\n  ${written.join("\n  ")}`);

function generateAll() {
  // 1. Wordmark (mark tile + "COLD FORGE"), text as outlines.
  function wordmarkSvg(): string {
    const h = 160;
    const size = 92;
    const tracking = 0.06;
    const textX = h + 44;
    const baseline = h / 2 + size * 0.36;
    const text = textRuns(
      [
        { text: "COLD", fill: COLORS.ice },
        { text: " ", fill: "none" },
        { text: "FORGE", fill: "url(#cf-wm-ember)" },
      ],
      textX,
      baseline,
      size,
      tracking,
    );
    const w = Math.ceil(textX + text.width + 8);
    const tile = between(logoSvg, "</defs>", "</svg>");
    const emberText = `<linearGradient id="cf-wm-ember" gradientUnits="userSpaceOnUse" x1="0" y1="${baseline - size * 0.75}" x2="0" y2="${baseline}"><stop offset="0" stop-color="#FDBA74"/><stop offset="1" stop-color="${COLORS.ember}"/></linearGradient>`;
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
      `<title>COLD FORGE</title><defs>${DEFS}${emberText}</defs>` +
      `<g transform="scale(${h / 512})">${tile}</g>${text.svg}</svg>\n`
    );
  }
  const wordmark = wordmarkSvg();
  write(join(import.meta.dir, "logo-wordmark.svg"), wordmark);
  write(join(import.meta.dir, "preview/logo-512.png"), png(logoSvg, 512));
  write(join(import.meta.dir, "preview/logo-wordmark.png"), png(wordmark, 1200));

  // 2. Favicons + PWA icons (identical sets for the app and the landing).
  const iconSets = {
    "favicon.svg": () => logoSvg,
    "favicon.ico": () => ico([16, 32, 48].map((size) => ({ size, data: png(logoSvg, size) }))),
    "apple-touch-icon.png": () => png(squareIcon(180, 0.62)),
  };
  for (const dir of [join(APP, "public"), join(LANDING, "public")]) {
    for (const [name, make] of Object.entries(iconSets)) write(join(dir, name), make());
  }
  const pub = join(APP, "public/icons");
  for (const s of [192, 512]) {
    write(join(pub, `icon-${s}.png`), png(logoSvg, s));
    // Maskable: the mark must survive a circle of radius 40% (W3C safe zone) → ~58% of the width.
    write(join(pub, `maskable-${s}.png`), png(squareIcon(s, 0.58)));
  }
  write(join(pub, "monochrome-512.png"), png(monoWhite(512, 0.58)));

  // 3. Open Graph images, one per locale (1200×630).
  const LANDING_COPY = { en: landingEn, es: landingEs, pt: landingPt } satisfies Record<Locale, unknown>;
  function ogSvg(locale: Locale): string {
    const W = 1200;
    const H = 630;
    const m = getMessages(locale);
    const c = LANDING_COPY[locale].hero.countdown;
    const colX = 520;
    const maxW = W - colX - 80;

    const brand = textRuns(
      [
        { text: "COLD", fill: COLORS.ice },
        { text: " ", fill: "none" },
        { text: "FORGE", fill: COLORS.ember },
      ],
      colX,
      186,
      34,
      0.32,
    );
    const tagSize = 78;
    const lines = wrap(m.tagline, tagSize, maxW, INTER_BLACK, -0.03);
    let y = 186 + 40 + tagSize;
    let tagline = "";
    for (const line of lines) {
      tagline += textRuns([{ text: line, fill: "#F8FAFC" }], colX, y, tagSize, -0.03).svg;
      y += tagSize * 1.04;
    }
    const sub = textRuns([{ text: `${c.label} · ${c.fallback}`, fill: COLORS.muted, font: INTER_BOLD }], colX, y + 36, 30, 0);
    const bar = `<rect x="${colX}" y="${y + 72}" width="${Math.min(maxW, 420)}" height="10" rx="5" fill="#1D2A3D"/><rect x="${colX}" y="${y + 72}" width="${Math.min(maxW, 420) * 0.62}" height="10" rx="5" fill="url(#og-bar)"/>`;

    const defs =
      `<radialGradient id="og-ember" cx="0.22" cy="0.42" r="0.5"><stop offset="0" stop-color="${COLORS.ember}" stop-opacity="0.30"/><stop offset="1" stop-color="${COLORS.ember}" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="og-ice" cx="0.95" cy="0" r="0.75"><stop offset="0" stop-color="${COLORS.iceStrong}" stop-opacity="0.22"/><stop offset="1" stop-color="${COLORS.iceStrong}" stop-opacity="0"/></radialGradient>` +
      `<linearGradient id="og-bar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${COLORS.iceStrong}"/><stop offset="1" stop-color="${COLORS.ember}"/></linearGradient>` +
      `<pattern id="og-lines" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(25)"><rect width="2" height="26" fill="${COLORS.ice}" fill-opacity="0.035"/></pattern>`;

    const body =
      `<rect width="${W}" height="${H}" fill="${COLORS.night}"/>` +
      `<rect width="${W}" height="${H}" fill="url(#og-lines)"/>` +
      `<rect width="${W}" height="${H}" fill="url(#og-ice)"/>` +
      `<rect width="${W}" height="${H}" fill="url(#og-ember)"/>` +
      placeMark(268, 318, 330) +
      brand.svg +
      tagline +
      sub.svg +
      bar +
      `<rect y="${H - 8}" width="${W}" height="8" fill="url(#og-bar)"/>`;
    return svgDoc(W, H, body, defs);
  }
  for (const locale of LOCALES) {
    const img = png(ogSvg(locale));
    write(join(LANDING, `public/og/og-${locale}.png`), img);
    if (locale === "en") write(join(APP, "public/og.png"), img);
  }

  // 4. Capacitor asset sources (`bunx @capacitor/assets generate --android` reads apps/app/assets).
  const assets = join(APP, "assets");
  write(join(assets, "icon-only.png"), png(squareIcon(1024, 0.66)));
  // Adaptive icon: @capacitor/assets insets the foreground by 16.7%, so this image is exactly the
  // visible 72dp area and launcher masks are inscribed in it → keep the mark's corners inside the circle.
  write(join(assets, "icon-foreground.png"), png(svgDoc(1024, 1024, placeMark(512, 512, 1024 * 0.62))));
  write(join(assets, "icon-background.png"), png(svgDoc(1024, 1024, fullBleed(1024))));
  write(join(assets, "icon-monochrome.png"), png(monoWhite(1024, 0.62)));
  function splashSvg(): string {
    const S = 2732;
    const name = textRuns(
      [
        { text: "COLD", fill: COLORS.ice },
        { text: " ", fill: "none" },
        { text: "FORGE", fill: COLORS.ember },
      ],
      0,
      0,
      120,
      0.3,
    );
    const nameX = (S - name.width) / 2;
    return svgDoc(
      S,
      S,
      `<rect width="${S}" height="${S}" fill="${COLORS.night}"/>` +
        `<radialGradient id="sp-glow" cx="0.5" cy="0.44" r="0.28"><stop offset="0" stop-color="${COLORS.ember}" stop-opacity="0.22"/><stop offset="1" stop-color="${COLORS.ember}" stop-opacity="0"/></radialGradient>` +
        `<rect width="${S}" height="${S}" fill="url(#sp-glow)"/>` +
        placeMark(S / 2, S / 2 - 90, 620) +
        `<g transform="translate(${r(nameX)} ${S / 2 + 400})">${name.svg}</g>`,
    );
  }
  const splash = png(splashSvg());
  write(join(assets, "splash.png"), splash);
  write(join(assets, "splash-dark.png"), splash);
}

/**
 * Android 13 themed icons: @capacitor/assets doesn't emit a <monochrome> layer, so add one
 * (same densities and inset as its foreground) to the adaptive icon XMLs. Idempotent.
 */
function androidMonochrome() {
  const res = join(APP, "android/app/src/main/res");
  if (!existsSync(res)) return;
  const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [density, size] of Object.entries(densities)) {
    write(join(res, `mipmap-${density}/ic_launcher_monochrome.png`), png(monoWhite(1024, 0.62), size));
  }
  const layer =
    '    <monochrome>\n        <inset android:drawable="@mipmap/ic_launcher_monochrome" android:inset="16.7%" />\n    </monochrome>\n';
  for (const name of ["ic_launcher.xml", "ic_launcher_round.xml"]) {
    const file = join(res, "mipmap-anydpi-v26", name);
    if (!existsSync(file)) continue;
    const xml = readFileSync(file, "utf8");
    if (!xml.includes("<monochrome>")) write(file, xml.replace("</adaptive-icon>", `${layer}</adaptive-icon>`));
  }
}
