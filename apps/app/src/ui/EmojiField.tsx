import { useEffect, useRef, useState } from "react";
import { checkEmoji } from "../lib/fields.ts";
import { TEXT_LIMITS } from "../lib/model.ts";

/** Curated fitness / discipline emojis (all pass the API's `isEmoji`; see fields.test.ts). */
export const EMOJI_CHOICES = [
  "🔥", "🧊", "❄️", "💪", "🏋️", "🏃", "🚶", "🚴", "🏊", "🧘", "🤸", "🥊", "⛹️", "🧗",
  "🏔️", "⚔️", "📚", "📖", "✍️", "🧠", "🎯", "🧹", "🛏️", "😴", "⏰", "🌅", "💧", "🥗",
  "🍎", "🥦", "🚭", "🍬", "📵", "💻", "🎸", "🎨", "🙏", "💊", "🦷", "🧴", "💰", "✅",
] as const;

interface Props {
  value: string;
  onChange: (emoji: string) => void;
  labels: { choose: string; type: string; invalid: string };
}

/**
 * Emoji button + picker grid, with a free-text fallback that only accepts what the API accepts
 * (one or two emoji graphemes). The parent must be `position: relative` (e.g. `.add-habit`).
 */
export function EmojiField({ value, onChange, labels }: Props) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [invalid, setInvalid] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as Element).closest?.(".emoji-btn")) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("pointerdown", onDown);
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("pointerdown", onDown);
      removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (e: string) => {
    onChange(e);
    setOpen(false);
    setTyped("");
    setInvalid(false);
  };

  return (
    <>
      <button
        type="button"
        className="emoji-btn"
        aria-label={labels.choose}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {value || "🔥"}
      </button>
      {open && (
        <div className="emoji-pop" ref={ref} role="dialog" aria-label={labels.choose}>
          <div className="emoji-grid">
            {EMOJI_CHOICES.map((e) => (
              <button key={e} type="button" className={`emoji-cell${e === value ? " on" : ""}`} onClick={() => pick(e)}>
                {e}
              </button>
            ))}
          </div>
          <input
            className="emoji-typed"
            value={typed}
            placeholder={labels.type}
            aria-label={labels.type}
            aria-invalid={invalid}
            maxLength={TEXT_LIMITS.emoji}
            onChange={(e) => {
              const v = e.target.value;
              setTyped(v);
              if (!v.trim()) return setInvalid(false);
              if (checkEmoji(v)) pick(v.trim());
              else setInvalid(true);
            }}
          />
          {invalid && <p className="field-hint">{labels.invalid}</p>}
        </div>
      )}
    </>
  );
}
