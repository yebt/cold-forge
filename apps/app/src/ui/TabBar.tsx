import type { UiMessages } from "../i18n/index.ts";
import { Icon } from "./Icon.tsx";

export type Tab = "today" | "progress" | "share" | "settings";

const ORDER: Tab[] = ["today", "progress", "share", "settings"];

export function TabBar({ tab, onChange, ui }: { tab: Tab; onChange: (t: Tab) => void; ui: UiMessages }) {
  return (
    <nav className="tabbar" aria-label={ui.tabs.label}>
      <div className="tabbar-inner">
        {ORDER.map((t) => (
          <button
            key={t}
            type="button"
            className={`tab${tab === t ? " active" : ""}`}
            aria-current={tab === t ? "page" : undefined}
            onClick={() => onChange(t)}
          >
            <Icon name={t} size={22} />
            <span className="tab-label">{ui.tabs[t]}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
