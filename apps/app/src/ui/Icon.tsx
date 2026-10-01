import { HABIT_TEMPLATES, type HabitTemplateId } from "@cold-forge/core";
import type { ReactNode } from "react";

/**
 * Stroke-line icons for UI chrome (24×24 grid, currentColor). Decorative by default: pair them with
 * visible text or an aria-label on the control.
 */
const PATHS = {
  today: <path d="M4 11l8-7 8 7v9H4z" />,
  progress: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  share: <path d="M12 3v13M7 8l5-5 5 5M5 14v6h14v-6" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" />
    </>
  ),
  check: <path d="M5 12l5 5L20 7" />,
  back: <path d="M15 6l-6 6 6 6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  upload: <path d="M12 16V5M7 10l5-5 5 5M5 20h14" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
    </>
  ),
  refresh: <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  flame: <path d="M12 21c-3.9 0-7-2.7-7-6.5 0-3.3 2.4-5.4 4-7.5.4 2 1.4 3 2.5 3.5C11 7 12.5 4.5 14.5 3c-.3 3 1.2 4.9 2.6 6.6 1.2 1.5 1.9 3 1.9 4.9 0 3.8-3.1 6.5-7 6.5z" />,
  snow: <path d="M12 2v20M4 6l16 12M20 6L4 18" />,
  medal: (
    <>
      <circle cx="12" cy="15" r="6" />
      <path d="M8.5 10.2L6 3h4l2 5 2-5h4l-2.5 7.2M12 12.5v5" />
    </>
  ),
  install: <path d="M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM12 8v7M9 12l3 3 3-3" />,
  calendar: <path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />,
  // Habit templates
  coldShower: <path d="M12 2v20M4 6l16 12M20 6L4 18" />,
  gym: <path d="M6 7v10M18 7v10M3 9v6M21 9v6M6 12h12" />,
  read: <path d="M3 5h6a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H3zM21 5h-6a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h7z" />,
  wakeEarly: (
    <>
      <circle cx="12" cy="13" r="7" />
      <path d="M12 10v3l2 2M5 4L3 6M19 4l2 2" />
    </>
  ),
  noSugar: (
    <>
      <path d="M7 9l5-3 5 3v6l-5 3-5-3z" />
      <path d="M4 4l16 16" />
    </>
  ),
  lessSocial: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M3 3l18 18" />
    </>
  ),
  meditate: (
    <>
      <circle cx="12" cy="5" r="2" />
      <path d="M12 8v5M7 11l5 2 5-2M4 19c2-3 5-3 8-3s6 0 8 3M8 19h8" />
    </>
  ),
  steps: (
    <path d="M8 3c1.7 0 2.5 1.8 2.5 4S9.7 11 8 11 5.5 9.2 5.5 7 6.3 3 8 3zM6 14h4v2a2 2 0 0 1-4 0zM16 8c1.7 0 2.5 1.8 2.5 4s-.8 4-2.5 4-2.5-1.8-2.5-4S14.3 8 16 8zM14 19h4v.5a2 2 0 0 1-4 0z" />
  ),
  water: <path d="M12 3c3 4 6 7.4 6 11a6 6 0 0 1-12 0c0-3.6 3-7 6-11z" />,
  journal: <path d="M6 3h11a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6zM6 3v18M9 8h6M9 12h6M4 7h4M4 17h4" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 20,
  strokeWidth = 1.8,
  className,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/** Every template habit has a matching line icon. */
export const HABIT_ICONS: Record<HabitTemplateId, IconName> = {
  coldShower: "coldShower",
  gym: "gym",
  read: "read",
  wakeEarly: "wakeEarly",
  noSugar: "noSugar",
  lessSocial: "lessSocial",
  meditate: "meditate",
  steps: "steps",
  water: "water",
  journal: "journal",
};

const TEMPLATE_EMOJI = new Map<string, string>(HABIT_TEMPLATES.map((t) => [t.id, t.emoji]));

/**
 * 40px habit tile: the template's line icon, or the user's own emoji (user data) on a neutral tile.
 * A template habit whose emoji the user changed keeps the emoji they picked.
 */
export function HabitIcon({
  habit,
  size = "md",
}: {
  habit: { templateId?: HabitTemplateId | undefined; emoji: string };
  size?: "sm" | "md";
}) {
  const icon =
    habit.templateId && TEMPLATE_EMOJI.get(habit.templateId) === habit.emoji ? HABIT_ICONS[habit.templateId] : undefined;
  return (
    <span className={`habit-icon ${size}${icon ? "" : " emoji"}`} aria-hidden="true">
      {icon ? <Icon name={icon} size={size === "sm" ? 16 : 20} /> : habit.emoji}
    </span>
  );
}
