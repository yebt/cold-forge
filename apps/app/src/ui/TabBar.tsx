import type { UiMessages } from "../i18n/index.ts";

export type Tab = "today" | "progress" | "share" | "settings";

const ICONS: Record<Tab, string> = { today: "🔥", progress: "📈", share: "📣", settings: "⚙️" };
const ORDER: Tab[] = ["today", "progress", "share", "settings"];

export function TabBar({ tab, onChange, ui }: { tab: Tab; onChange: (t: Tab) => void; ui: UiMessages }) {
  return (
    <nav className="tabbar" aria-label="Main">
      {ORDER.map((t) => (
        <button
          key={t}
          className={`tab${tab === t ? " active" : ""}`}
          aria-current={tab === t ? "page" : undefined}
          onClick={() => onChange(t)}
        >
          <span className="tab-icon" aria-hidden="true">
            {ICONS[t]}
          </span>
          <span className="tab-label">{ui.tabs[t]}</span>
        </button>
      ))}
    </nav>
  );
}
