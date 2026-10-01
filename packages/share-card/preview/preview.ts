/**
 * Renders sample cards for eyeballing: `bun run preview` (from packages/share-card).
 * Each rendered <img> carries `data-name`; `window.__previewDone` flips true when finished.
 */
import {
  addDays,
  computeArcStats,
  eachDay,
  MILESTONE_DAYS,
  winterArcWindow,
  type Arc,
  type CheckIn,
  type Habit,
  type ISODate,
} from "@cold-forge/core";
import { MESSAGES, type Locale } from "@cold-forge/i18n";
import { createRng } from "../src/rng.ts";
import { renderShareCard, STORY_HEIGHT, STORY_SAFE_ZONE, type ShareCardInput } from "../src/index.ts";

const window_ = winterArcWindow(2026);

const HABITS: Habit[] = [
  { id: "cold", name: "Cold shower", emoji: "🧊", createdAt: "2026-10-01T00:00:00Z" },
  { id: "gym", name: "Gym", emoji: "🏋️", createdAt: "2026-10-01T00:00:00Z" },
  { id: "read", name: "Read 20 pages of a really long philosophy book every single night", emoji: "📚", createdAt: "2026-10-01T00:00:00Z" },
  { id: "wake", name: "Wake up at 5am", emoji: "⏰", createdAt: "2026-10-01T00:00:00Z" },
  { id: "water", name: "Drink 2L of water", emoji: "💧", createdAt: "2026-10-01T00:00:00Z" },
  { id: "med", name: "Meditate", emoji: "🧘", createdAt: "2026-10-01T00:00:00Z" },
  { id: "journal", name: "Journal", emoji: "📓", createdAt: "2026-10-01T00:00:00Z" },
];

const HABITS_ES: Habit[] = [
  { id: "cold", name: "Ducha fría", emoji: "🧊", createdAt: "" },
  { id: "gym", name: "Gimnasio", emoji: "🏋️", createdAt: "" },
  { id: "read", name: "Leer 20 páginas antes de dormir sin el celular", emoji: "📚", createdAt: "" },
  { id: "wake", name: "Despertar a las 5", emoji: "⏰", createdAt: "" },
  { id: "sugar", name: "Sin azúcar", emoji: "🚫", createdAt: "" },
];

const HABITS_PT: Habit[] = [
  { id: "cold", name: "Banho gelado", emoji: "🧊", createdAt: "" },
  { id: "gym", name: "Academia", emoji: "🏋️", createdAt: "" },
  { id: "read", name: "Ler 20 min", emoji: "📚", createdAt: "" },
  { id: "steps", name: "10 mil passos", emoji: "🚶", createdAt: "" },
];

/** Deterministic fake history: `rate` chance per habit per day, with perfect runs at the end. */
function history(arc: Arc, today: ISODate, rate: number, perfectTail: number, seed: string): CheckIn[] {
  const rng = createRng(seed);
  const last = today < arc.endDate ? today : arc.endDate;
  const days = today < arc.startDate ? [] : eachDay(arc.startDate, last);
  const tailStart = addDays(last, -(perfectTail - 1));
  const out: CheckIn[] = [];
  for (const d of days) {
    for (const h of arc.habits) {
      if (d >= tailStart || rng.chance(rate)) out.push({ habitId: h.id, date: d });
    }
  }
  return out;
}

interface Sample {
  name: string;
  locale: Locale;
  arc: Arc;
  today: ISODate;
  rate: number;
  tail: number;
  kind: ShareCardInput["kind"];
  milestoneDay?: number;
  displayName?: string;
}

const arc = (title: string, habits: Habit[]): Arc => ({ id: "a", title, ...window_, habits });
const dayN = (n: number) => addDays(window_.startDate, n - 1);

const SAMPLES: Sample[] = [
  { name: "story-en-day1", locale: "en", arc: arc("Winter Arc 2026", HABITS.slice(0, 3)), today: dayN(1), rate: 0, tail: 1, kind: "story", displayName: "@yahir" },
  { name: "story-es-day23", locale: "es", arc: arc("Winter Arc 2026", HABITS_ES), today: dayN(23), rate: 0.7, tail: 9, kind: "story", displayName: "@yahir.bravo" },
  { name: "story-pt-finished", locale: "pt", arc: arc("Meu Winter Arc", HABITS_PT), today: "2027-01-03", rate: 0.82, tail: 40, kind: "story" },
  { name: "story-en-7habits", locale: "en", arc: arc("The Coldest, Hardest, Most Disciplined Winter Arc Of My Entire Life", HABITS), today: dayN(61), rate: 0.75, tail: 5, kind: "story", displayName: "Maximilian Alexander von Habsburg-Lothringen the Third" },
  { name: "story-es-0habits", locale: "es", arc: arc("Winter Arc", []), today: dayN(12), rate: 0, tail: 0, kind: "story" },
  { name: "story-pt-upcoming", locale: "pt", arc: arc("Winter Arc 2026", HABITS_PT), today: "2026-09-20", rate: 0, tail: 0, kind: "story" },
  ...MILESTONE_DAYS.flatMap((d, i): Sample[] => {
    const locale = (["es", "en", "pt", "en", "pt"] as const)[i]!;
    const habits = locale === "es" ? HABITS_ES : locale === "pt" ? HABITS_PT : HABITS.slice(0, 4);
    return [{ name: `milestone-${d}-${locale}`, locale, arc: arc("Winter Arc 2026", habits), today: dayN(d), rate: 0.85, tail: Math.min(d, 7 + i * 15), kind: "milestone", milestoneDay: d, displayName: i % 2 ? undefined : "@yahir" }];
  }),
  { name: "milestone-50-es", locale: "es", arc: arc("Winter Arc 2026", HABITS_ES), today: dayN(50), rate: 0.8, tail: 30, kind: "milestone", milestoneDay: 50 },
];

async function main() {
  const grid = document.getElementById("grid")!;
  const results: Record<string, string> = {};
  for (const s of SAMPLES) {
    const fig = document.createElement("figure");
    fig.style.position = "relative";
    grid.append(fig);
    try {
      const checkIns = history(s.arc, s.today, s.rate, s.tail, s.name);
      const stats = computeArcStats(s.arc, checkIns, s.today);
      const t0 = performance.now();
      const blob = await renderShareCard({
        kind: s.kind,
        stats,
        checkIns,
        arc: s.arc,
        messages: MESSAGES[s.locale],
        milestoneDay: s.milestoneDay,
        displayName: s.displayName,
      });
      const ms = Math.round(performance.now() - t0);
      const url = await blobToDataUrl(blob);
      results[s.name] = url;
      const img = document.createElement("img");
      img.src = url;
      img.dataset.name = s.name;
      const caption = document.createElement("figcaption");
      caption.textContent = `${s.name} · ${Math.round(blob.size / 1024)} KB · ${ms} ms`;
      fig.append(img, safeOverlay(), caption);
    } catch (err) {
      const pre = document.createElement("pre");
      pre.className = "err";
      pre.textContent = `${s.name}: ${err instanceof Error ? err.stack : String(err)}`;
      fig.append(pre);
    }
  }
  Object.assign(window, { __previewResults: results, __previewDone: true });
}

function safeOverlay(): HTMLElement {
  const el = document.createElement("div");
  const top = (STORY_SAFE_ZONE.top / STORY_HEIGHT) * 100;
  const bottom = ((STORY_HEIGHT - STORY_SAFE_ZONE.bottom) / STORY_HEIGHT) * 100;
  el.className = "safe";
  el.style.cssText = `position:absolute;left:0;right:0;top:0;aspect-ratio:9/16;pointer-events:none;display:none;
    background:linear-gradient(to bottom, rgba(255,0,80,.35) ${top}%, transparent ${top}%, transparent ${100 - bottom}%, rgba(255,0,80,.35) ${100 - bottom}%);border-radius:12px`;
  return el;
}

document.getElementById("safe")?.addEventListener("change", (e) => {
  const on = (e.target as HTMLInputElement).checked;
  document.querySelectorAll<HTMLElement>(".safe").forEach((el) => (el.style.display = on ? "block" : "none"));
});

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

void main();
