import { buildMilestoneShareText, buildShareText } from "@cold-forge/i18n";
import { renderShareCard } from "@cold-forge/share-card";
import { useEffect, useMemo, useState } from "react";
import { milestoneStates } from "../lib/milestones.ts";
import { copyText, shareFile } from "../platform/share.ts";
import { useApp } from "../state.tsx";

export type ShareTarget = { kind: "story" } | { kind: "milestone"; day: number };

type Preview = { status: "loading" } | { status: "ready"; blob: Blob; url: string } | { status: "error" };

export function Share({ target, onTarget }: { target: ShareTarget; onTarget: (t: ShareTarget) => void }) {
  const { data, t, derived } = useApp();
  const { ui, m } = t;
  const { stats, checkIns } = derived;
  const [preview, setPreview] = useState<Preview>({ status: "loading" });
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const milestoneDay = target.kind === "milestone" ? target.day : undefined;
  const text = useMemo(
    () => (milestoneDay === undefined ? buildShareText(stats, m) : buildMilestoneShareText(stats, milestoneDay, m)),
    [stats, m, milestoneDay],
  );
  const reached = milestoneStates(stats).filter((s) => s.reached);
  const displayName = data.settings.displayName;

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setPreview({ status: "loading" });
    renderShareCard({
      kind: target.kind,
      stats,
      checkIns,
      arc: { startDate: data.arc.startDate, endDate: data.arc.endDate },
      messages: m,
      ...(milestoneDay !== undefined ? { milestoneDay } : {}),
      ...(displayName ? { displayName } : {}),
    })
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setPreview({ status: "ready", blob, url });
      })
      .catch((e: unknown) => {
        console.warn("[share-card]", e);
        if (!cancelled) setPreview({ status: "error" });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [target.kind, milestoneDay, stats, checkIns, m, data.arc.startDate, data.arc.endDate, displayName]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  const onCopy = async () => setToast((await copyText(text)) ? ui.share.copied : ui.share.shareFailed);

  const onShareImage = async () => {
    if (preview.status !== "ready") {
      await copyText(text);
      setToast(ui.share.shareFailed);
      return;
    }
    setBusy(true);
    try {
      const name = target.kind === "milestone" ? `cold-forge-day-${target.day}.png` : `cold-forge-day-${stats.day}.png`;
      const outcome = await shareFile(preview.blob, name, text);
      if (outcome === "downloaded") setToast(ui.share.downloaded);
    } catch (e) {
      console.warn("[share]", e);
      await copyText(text);
      setToast(ui.share.shareFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="share">
      <h1 className="screen-title">{ui.share.title}</h1>

      {reached.length > 0 && (
        <div className="pills-row" role="radiogroup">
          <button
            role="radio"
            aria-checked={target.kind === "story"}
            className={`pill${target.kind === "story" ? " on" : ""}`}
            onClick={() => onTarget({ kind: "story" })}
          >
            📱 {ui.share.story}
          </button>
          {reached.map((r) => (
            <button
              key={r.day}
              role="radio"
              aria-checked={milestoneDay === r.day}
              className={`pill${milestoneDay === r.day ? " on" : ""}`}
              onClick={() => onTarget({ kind: "milestone", day: r.day })}
            >
              🏅 {ui.share.milestone(r.day)}
            </button>
          ))}
        </div>
      )}

      <div className="card-preview">
        {preview.status === "ready" && <img src={preview.url} alt={text} />}
        {preview.status === "loading" && <div className="preview-loading">{ui.share.rendering}</div>}
        {preview.status === "error" && <FallbackCard milestoneDay={milestoneDay} />}
      </div>
      {preview.status === "error" && <p className="muted small center">{ui.share.previewFailed}</p>}

      <div className="share-actions">
        <button className="btn primary" onClick={onShareImage} disabled={busy || preview.status === "loading"}>
          📤 {ui.share.shareImage}
        </button>
        <button className="btn secondary" onClick={onCopy}>
          📋 {ui.share.copyText}
        </button>
      </div>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

/** HTML stand-in for the PNG card when canvas rendering isn't available. */
function FallbackCard({ milestoneDay }: { milestoneDay: number | undefined }) {
  const { data, t, derived } = useApp();
  const { m } = t;
  const { stats } = derived;
  const pct = Math.round((stats.day / stats.totalDays) * 100);
  return (
    <div className="fallback-card">
      <span className="fc-brand">COLD FORGE</span>
      <span className="fc-title">{stats.title}</span>
      {milestoneDay !== undefined ? (
        <>
          <span className="fc-day">🏅 {milestoneDay}</span>
          <span className="fc-sub">{m.milestones[milestoneDay]}</span>
        </>
      ) : (
        <>
          <span className="fc-day">{m.stats.day(stats.day, stats.totalDays)}</span>
          <div className="bar">
            <div style={{ width: `${pct}%` }} />
          </div>
        </>
      )}
      <div className="fc-stats">
        <span>
          <strong>{stats.perfectStreak}🔥</strong>
          {m.stats.perfectStreak}
        </span>
        <span>
          <strong>{Math.round(stats.completionRate * 100)}%</strong>
          {m.stats.completion}
        </span>
        <span>
          <strong>{stats.rank.emoji}</strong>
          {m.ranks[stats.rank.id]}
        </span>
      </div>
      <ul className="fc-habits">
        {stats.habits.slice(0, 6).map((h) => (
          <li key={h.habit.id}>
            <span>
              {h.habit.emoji} {h.habit.name}
            </span>
            <span>{h.currentStreak}🔥</span>
          </li>
        ))}
      </ul>
      {data.settings.displayName && <span className="fc-name">{data.settings.displayName}</span>}
      <span className="fc-foot">#WinterArc</span>
    </div>
  );
}
