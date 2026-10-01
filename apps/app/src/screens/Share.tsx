import { buildMilestoneShareText, buildShareText } from "@cold-forge/i18n";
import { renderShareCard } from "@cold-forge/share-card";
import { useEffect, useMemo, useState } from "react";
import { milestoneStates } from "../lib/milestones.ts";
import { copyText, shareFile } from "../platform/share.ts";
import { useApp } from "../state.tsx";
import { Icon } from "../ui/Icon.tsx";

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
      <header className="screen-head">
        <h1 className="screen-title">{ui.tabs.share}</h1>
      </header>
      <p className="lead">{ui.share.title}</p>

      <div className="chip-row" role="radiogroup" aria-label={ui.share.kindLabel}>
        <button
          type="button"
          role="radio"
          aria-checked={target.kind === "story"}
          className={`chip${target.kind === "story" ? " on" : ""}`}
          onClick={() => onTarget({ kind: "story" })}
        >
          {ui.share.story}
        </button>
        {reached.map((r) => (
          <button
            key={r.day}
            type="button"
            role="radio"
            aria-checked={milestoneDay === r.day}
            className={`chip${milestoneDay === r.day ? " on" : ""}`}
            onClick={() => onTarget({ kind: "milestone", day: r.day })}
          >
            {ui.share.milestone(r.day)}
          </button>
        ))}
      </div>

      <div className="card-preview" aria-label={ui.share.previewLabel} aria-busy={preview.status === "loading"}>
        {preview.status === "ready" && <img src={preview.url} alt={text} />}
        {preview.status === "loading" && (
          <div className="preview-loading" role="status">
            {ui.share.rendering}
          </div>
        )}
        {preview.status === "error" && <FallbackCard milestoneDay={milestoneDay} />}
      </div>
      {preview.status === "error" && <p className="muted small center">{ui.share.previewFailed}</p>}

      <div className="share-actions">
        <button type="button" className="btn primary block" onClick={onShareImage} disabled={busy || preview.status === "loading"}>
          <Icon name="share" size={18} strokeWidth={2.2} />
          {ui.share.shareImage}
        </button>
        <button type="button" className="btn secondary block" onClick={onCopy}>
          <Icon name="copy" size={18} />
          {ui.share.copyText}
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
  return (
    <div className="fallback-card">
      <span className="fc-kicker">{stats.title}</span>
      {milestoneDay !== undefined ? (
        <>
          <span className="fc-tag">{t.ui.milestone.title}</span>
          <span className="fc-big">{milestoneDay}</span>
          <span className="fc-sub">{m.milestones[milestoneDay]}</span>
        </>
      ) : (
        <>
          <span className="fc-big ember">{stats.day}</span>
          <span className="fc-sub">{m.stats.day(stats.day, stats.totalDays)}</span>
          <span className="fc-meta">
            {m.stats.perfectStreak} {stats.perfectStreak} · {m.ranks[stats.rank.id]} · {Math.round(stats.completionRate * 100)}%
          </span>
        </>
      )}
      {data.settings.displayName && <span className="fc-name">{data.settings.displayName}</span>}
      <span className="fc-foot">COLD FORGE · #WINTERARC</span>
    </div>
  );
}
