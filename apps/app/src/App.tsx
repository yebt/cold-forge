import { detectLocale } from "@cold-forge/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getTranslations } from "./i18n/index.ts";
import { dayProgress, derive } from "./lib/derive.ts";
import { pendingMilestone } from "./lib/milestones.ts";
import { createAppData, markMilestonesCelebrated, type AppData, type OnboardingInput } from "./lib/model.ts";
import { planReminders } from "./lib/reminders.ts";
import { syncReminders } from "./platform/notifications.ts";
import { repository } from "./platform/storage.ts";
import { Onboarding } from "./screens/Onboarding.tsx";
import { Progress } from "./screens/Progress.tsx";
import { Settings } from "./screens/Settings.tsx";
import { Share, type ShareTarget } from "./screens/Share.tsx";
import { Today } from "./screens/Today.tsx";
import { AppContext, nowISO, todayLocal, type AppState, type Updater } from "./state.tsx";
import { MilestoneModal } from "./screens/MilestoneModal.tsx";
import { TabBar, type Tab } from "./ui/TabBar.tsx";

type Phase = { kind: "loading" } | { kind: "onboarding"; carry?: AppData } | { kind: "ready"; data: AppData };

function browserLocale() {
  return detectLocale(typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language]);
}

/** Keeps "today" fresh across midnight and when the app comes back to the foreground. */
function useToday() {
  const [today, setToday] = useState(todayLocal);
  useEffect(() => {
    const check = () => setToday(todayLocal());
    const id = setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  return today;
}

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const today = useToday();

  useEffect(() => {
    repository
      .load()
      .then((data) => setPhase(data ? { kind: "ready", data } : { kind: "onboarding" }))
      .catch(() => setPhase({ kind: "onboarding" }));
  }, []);

  const locale =
    phase.kind === "ready" ? phase.data.settings.locale : (phase.kind === "onboarding" && phase.carry?.settings.locale) || browserLocale();

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const finishOnboarding = useCallback(
    (input: OnboardingInput) => {
      const carry = phase.kind === "onboarding" ? phase.carry : undefined;
      const data = createAppData({ ...input, ...(carry ? { settings: carry.settings } : {}) }, nowISO());
      void repository.save(data);
      setPhase({ kind: "ready", data });
    },
    [phase],
  );

  if (phase.kind === "loading") {
    return <div className="splash">🧊</div>;
  }
  if (phase.kind === "onboarding") {
    return (
      <Onboarding
        initialLocale={locale}
        initialName={phase.carry?.settings.displayName ?? ""}
        initialWhy={phase.carry?.arc.why ?? ""}
        today={today}
        onDone={finishOnboarding}
      />
    );
  }
  return (
    <ReadyApp
      data={phase.data}
      today={today}
      setData={(data) => setPhase({ kind: "ready", data })}
      restart={(carry) => setPhase({ kind: "onboarding", ...(carry ? { carry } : {}) })}
    />
  );
}

interface ReadyProps {
  data: AppData;
  today: string;
  setData: (d: AppData) => void;
  restart: (carry?: AppData) => void;
}

function ReadyApp({ data, today, setData, restart }: ReadyProps) {
  const [tab, setTab] = useState<Tab>("today");
  const [shareTarget, setShareTarget] = useState<ShareTarget>({ kind: "story" });
  const [milestone, setMilestone] = useState<number | null>(null);
  const t = useMemo(() => getTranslations(data.settings.locale), [data.settings.locale]);
  const derived = useMemo(() => derive(data, t.m, today), [data, t, today]);

  // Always apply updates to the latest data, even when several fire before a re-render.
  const dataRef = useRef(data);
  dataRef.current = data;
  const update = useCallback(
    (fn: Updater) => {
      const next = fn(dataRef.current, nowISO());
      if (next === dataRef.current) return;
      dataRef.current = next;
      setData(next);
      void repository.save(next);
    },
    [setData],
  );

  const reset = useCallback(async () => {
    await repository.clear();
    await syncReminders([]);
    restart();
  }, [restart]);

  // Milestone celebration, the first time a milestone day is reached.
  const { stats } = derived;
  useEffect(() => {
    const pending = pendingMilestone(stats, data.celebratedMilestones);
    if (!pending) return;
    setMilestone(pending.day);
    update((d) => markMilestonesCelebrated(d, pending.alsoMark));
  }, [stats, data.celebratedMilestones, update]);

  // Keep scheduled reminders fresh (on open and whenever data changes).
  const { done, total } = dayProgress(data, today);
  const { reminderEnabled, reminderTime } = data.settings;
  useEffect(() => {
    const handle = setTimeout(() => {
      void syncReminders(
        planReminders(
          {
            enabled: reminderEnabled,
            time: reminderTime,
            now: new Date(),
            today,
            arcStart: data.arc.startDate,
            arcEnd: data.arc.endDate,
            habitsLeftToday: total - done,
            perfectStreak: stats.perfectStreak,
          },
          t.ui.reminder,
        ),
      );
    }, 800);
    return () => clearTimeout(handle);
  }, [reminderEnabled, reminderTime, today, data.arc.startDate, data.arc.endDate, done, total, stats.perfectStreak, t]);

  const state: AppState = { data, today, t, derived, update, reset };

  const goShare = (target: ShareTarget) => {
    setShareTarget(target);
    setTab("share");
  };

  return (
    <AppContext.Provider value={state}>
      <div className="app">
        <main className="screen" key={tab}>
          {tab === "today" && <Today onNewArc={() => restart(data)} />}
          {tab === "progress" && <Progress />}
          {tab === "share" && <Share target={shareTarget} onTarget={setShareTarget} />}
          {tab === "settings" && <Settings />}
        </main>
        <TabBar tab={tab} onChange={setTab} ui={t.ui} />
      </div>
      {milestone !== null && (
        <MilestoneModal
          day={milestone}
          onClose={() => setMilestone(null)}
          onShare={() => {
            setMilestone(null);
            goShare({ kind: "milestone", day: milestone });
          }}
        />
      )}
    </AppContext.Provider>
  );
}
