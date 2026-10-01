/**
 * Captures the PWA manifest screenshots (1080×1920, "narrow") from the real app build.
 *
 *   bun run --filter @cold-forge/app build
 *   (cd apps/app && bunx vite preview --port 4173 --strictPort) &
 *   CHROMIUM_PATH=/path/to/chrome bun brand/screenshots.ts [http://localhost:4173/]
 *
 * It goes through onboarding with the clock frozen mid-arc, seeds ~6 weeks of check-ins straight into
 * the app's storage (Capacitor Preferences = localStorage on the web), and shoots Today and Progress.
 * Uses playwright-core (devDependency of @cold-forge/app); point CHROMIUM_PATH at any Chromium.
 */
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const APP = join(ROOT, "apps/app");
const { chromium } = (await import(Bun.resolveSync("playwright-core", APP))) as typeof import("playwright-core");

const url = process.argv[2] ?? "http://localhost:4173/";
const executablePath = process.env.CHROMIUM_PATH;
const OUT = join(APP, "public/screenshots");
const NOW = new Date("2026-11-14T08:40:00");
const STORAGE_KEY = "CapacitorStorage.coldforge.data.v1";

const browser = await chromium.launch(executablePath ? { executablePath } : {});
// 360×640 CSS px at 3x = 1080×1920.
const context = await browser.newContext({
  viewport: { width: 360, height: 640 },
  deviceScaleFactor: 3,
  locale: "en-US",
  serviceWorkers: "block",
  reducedMotion: "reduce",
});
const page = await context.newPage();
await page.clock.setFixedTime(NOW);
page.on("pageerror", (e) => console.error("pageerror:", e.message));
await page.goto(url);

// Onboarding: Winter Arc (default) → habits → the remaining steps with defaults.
await page.getByRole("button", { name: "Next" }).click();
for (const habit of ["Cold shower", "Gym", "Read 20 min", "Wake up early", "10k steps"]) {
  await page.getByRole("button", { name: new RegExp(habit) }).first().click();
}
for (let i = 0; i < 6; i++) {
  const next = page.getByRole("button", { name: /^(Next|Start|Begin|Done|.*Light the forge)/ }).last();
  if (!(await next.count()) || !(await next.isEnabled())) break;
  await next.click();
  await page.waitForTimeout(250);
  const name = page.locator('input[type="text"]').first();
  if ((await name.count()) && !(await name.inputValue())) await name.fill("Alex");
}
await page.waitForFunction((key) => !!localStorage.getItem(key), STORAGE_KEY);

// Seed history: a strong but human run since Oct 1, with a few misses, plus three of five habits done today.
await page.evaluate(
  ({ key, today }) => {
    const data = JSON.parse(localStorage.getItem(key)!);
    const habits = (data.habits as { id: string; deletedAt?: string }[]).filter((h) => !h.deletedAt);
    const pad = (n: number) => String(n).padStart(2, "0");
    const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const start = new Date(2026, 9, 1);
    const end = new Date(today);
    let n = 0;
    for (let d = new Date(start); iso(d) < iso(end); d.setDate(d.getDate() + 1), n++) {
      habits.forEach((h, i) => {
        // Deterministic misses: mostly early on, never in the last 9 days (keeps a visible streak).
        const miss = (n * 7 + i * 13) % 17 === 0 && n < 35;
        const date = iso(d);
        data.checkIns[`${h.id}|${date}`] = { habitId: h.id, date, done: !miss, updatedAt: `${date}T21:00:00.000Z` };
      });
    }
    const t = iso(end);
    habits.slice(0, 3).forEach((h) => {
      data.checkIns[`${h.id}|${t}`] = { habitId: h.id, date: t, done: true, updatedAt: `${t}T07:30:00.000Z` };
    });
    localStorage.setItem(key, JSON.stringify(data));
  },
  { key: STORAGE_KEY, today: NOW.toISOString() },
);
await page.reload();
await page.waitForTimeout(800);
await page.screenshot({ path: join(OUT, "today.png") });
await page.getByRole("tab", { name: /Progress/ }).or(page.getByRole("button", { name: /Progress/ })).first().click();
await page.waitForTimeout(800);
await page.screenshot({ path: join(OUT, "progress.png") });
await browser.close();
console.log(`screenshots: wrote ${OUT}/today.png and progress.png`);
