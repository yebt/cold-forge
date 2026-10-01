/** Pure display helpers (unit-tested). */

const dateFmt = new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function parse(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function formatDate(iso: string | null | undefined): string {
  const ms = parse(iso);
  return ms === null ? "—" : dateFmt.format(ms);
}

export function formatDateTime(iso: string | null | undefined): string {
  const ms = parse(iso);
  return ms === null ? "—" : dateTimeFmt.format(ms);
}

/** "just now", "5m ago", "3h ago", "2d ago", then a date. */
export function formatRelative(iso: string | null | undefined, now: number = Date.now()): string {
  const ms = parse(iso);
  if (ms === null) return "—";
  const diff = Math.max(0, now - ms);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return formatDate(iso);
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en");
}

const PROVIDERS: Record<string, string> = {
  "google.com": "Google",
  password: "Email",
  "apple.com": "Apple",
  "github.com": "GitHub",
  phone: "Phone",
  anonymous: "Anonymous",
};

export function providerLabel(id: string): string {
  return PROVIDERS[id] ?? id;
}

/** Initials for the avatar fallback. */
export function initials(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name ?? "").trim() || (email ?? "").split("@")[0] || "?";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0]![0]}${parts[1]![0]}` : source.slice(0, 2);
  return letters.toUpperCase();
}

/** Only Google-hosted avatars may load (CSP img-src allows just lh3.googleusercontent.com). */
export function safePhoto(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "lh3.googleusercontent.com" ? u.href : null;
  } catch {
    return null;
  }
}

export function confirmMatches(typed: string, expected: string): boolean {
  return typed.trim().toLowerCase() === expected.trim().toLowerCase() && expected.trim() !== "";
}

export const REASON_MIN = 3;
export const REASON_MAX = 500;

export function reasonValid(reason: string): boolean {
  const r = reason.trim();
  // eslint-disable-next-line no-control-regex
  return r.length >= REASON_MIN && r.length <= REASON_MAX && !/[\u0000-\u001f\u007f]/.test(r);
}
