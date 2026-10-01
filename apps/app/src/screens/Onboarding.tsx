import { HABIT_TEMPLATES, type HabitTemplateId, type ISODate } from "@cold-forge/core";
import { LOCALES, LOCALE_NAMES, type Locale } from "@cold-forge/i18n";
import { useMemo, useState, type FormEvent } from "react";
import { formatShortDate, getTranslations } from "../i18n/index.ts";
import { arcOptions, type ArcOption } from "../lib/derive.ts";
import { TEXT_LIMITS, type NewHabitInput, type OnboardingInput } from "../lib/model.ts";
import { checkEmoji, checkField } from "../lib/fields.ts";
import { EmojiField } from "../ui/EmojiField.tsx";
import { FieldHint } from "../ui/FieldHint.tsx";

interface Props {
  initialLocale: Locale;
  initialName: string;
  initialWhy: string;
  today: ISODate;
  onDone: (input: OnboardingInput) => void;
}

const STEPS = 3;

export function Onboarding({ initialLocale, initialName, initialWhy, today, onDone }: Props) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const { ui, m } = useMemo(() => getTranslations(locale), [locale]);
  const o = ui.onboarding;
  const options = useMemo(() => arcOptions(today), [today]);

  const [step, setStep] = useState(1);
  const [arc, setArc] = useState<ArcOption>(options.winter);
  const [picked, setPicked] = useState<HabitTemplateId[]>([]);
  const [custom, setCustom] = useState<NewHabitInput[]>([]);
  const [customName, setCustomName] = useState("");
  const [customEmoji, setCustomEmoji] = useState("🔥");
  const [why, setWhy] = useState(initialWhy);
  const [name, setName] = useState(initialName);

  const count = picked.length + custom.length;
  const f = ui.fields;
  const customProblem = checkField("name", customName);
  const whyProblem = checkField("why", why);
  const nameProblem = checkField("displayName", name);
  const year = Number(options.winter.window.startDate.slice(0, 4));

  const toggle = (id: HabitTemplateId) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const addCustom = (e: FormEvent) => {
    e.preventDefault();
    if (customProblem || !checkEmoji(customEmoji)) return;
    setCustom((c) => [...c, { name: customName.trim(), emoji: customEmoji.trim() }]);
    setCustomName("");
    setCustomEmoji("🔥");
  };

  const finish = () => {
    const habits: NewHabitInput[] = [
      ...HABIT_TEMPLATES.filter((t) => picked.includes(t.id)).map((t) => ({
        templateId: t.id,
        name: m.habits[t.id],
        emoji: t.emoji,
      })),
      ...custom,
    ];
    onDone({ kind: arc.kind, window: arc.window, habits, why, displayName: name, locale });
  };

  return (
    <div className="onboarding">
      <header className="ob-head">
        <div className="brand">COLD FORGE</div>
        <div className="ob-progress" aria-label={o.stepOf(step, STEPS)}>
          {Array.from({ length: STEPS }, (_, i) => (
            <span key={i} className={i < step ? "on" : ""} />
          ))}
        </div>
      </header>

      {step === 1 && (
        <section className="ob-step">
          <div className="lang-pills" role="radiogroup" aria-label="Language">
            {LOCALES.map((l) => (
              <button
                key={l}
                role="radio"
                aria-checked={l === locale}
                className={`pill${l === locale ? " on" : ""}`}
                onClick={() => setLocale(l)}
              >
                {LOCALE_NAMES[l]}
              </button>
            ))}
          </div>
          <p className="ob-kicker">{o.welcome}</p>
          <h1>{o.arcTitle}</h1>
          <p className="muted">{o.arcLead}</p>
          <div className="arc-options" role="radiogroup">
            <button
              role="radio"
              aria-checked={arc.kind === "winter"}
              className={`arc-option${arc.kind === "winter" ? " on" : ""}`}
              onClick={() => setArc(options.winter)}
            >
              <span className="arc-emoji">❄️</span>
              <span className="arc-text">
                <strong>{o.winterTitle(year)}</strong>
                <span>
                  {options.winter.status === "upcoming"
                    ? o.winterUpcoming(options.winter.startsIn)
                    : o.winterActive(options.winter.day)}
                </span>
              </span>
            </button>
            <button
              role="radio"
              aria-checked={arc.kind === "custom"}
              className={`arc-option${arc.kind === "custom" ? " on" : ""}`}
              onClick={() => setArc(options.custom)}
            >
              <span className="arc-emoji">🔥</span>
              <span className="arc-text">
                <strong>{o.customTitleOpt}</strong>
                <span>{o.customSub(formatShortDate(options.custom.window.endDate, locale))}</span>
              </span>
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="ob-step">
          <h1>{o.habitsTitle}</h1>
          <p className="muted">{o.habitsLead}</p>
          <div className="chips">
            {HABIT_TEMPLATES.map((t) => {
              const on = picked.includes(t.id);
              return (
                <button key={t.id} className={`chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => toggle(t.id)}>
                  <span aria-hidden="true">{t.emoji}</span> {m.habits[t.id]}
                </button>
              );
            })}
            {custom.map((c, i) => (
              <button
                key={`c${i}`}
                className="chip on"
                aria-pressed="true"
                onClick={() => setCustom((list) => list.filter((_, j) => j !== i))}
              >
                <span aria-hidden="true">{c.emoji}</span> {c.name} <span aria-hidden="true">✕</span>
              </button>
            ))}
          </div>
          <form className="add-habit" onSubmit={addCustom}>
            <EmojiField
              value={customEmoji}
              onChange={setCustomEmoji}
              labels={{ choose: f.chooseEmoji, type: f.typeEmoji, invalid: f.emojiInvalid }}
            />
            <input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder={o.customHabit}
              aria-label={o.customName}
              aria-invalid={customName !== "" && customProblem !== null}
              maxLength={TEXT_LIMITS.name}
            />
            <button type="submit" className="btn secondary" disabled={customProblem !== null}>
              {ui.common.add}
            </button>
          </form>
          <FieldHint problem={customName === "" ? null : customProblem} field="name" f={f} />
          <p className="muted small">{count > 0 ? o.selected(count) : o.pickOne}</p>
        </section>
      )}

      {step === 3 && (
        <section className="ob-step">
          <h1>{o.whyTitle}</h1>
          <p className="muted">{o.whyLead}</p>
          <textarea
            className="why-input"
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            placeholder={o.whyPlaceholder}
            maxLength={140}
            rows={3}
            aria-invalid={whyProblem !== null}
          />
          <FieldHint problem={whyProblem} field="why" f={f} />
          <label className="field">
            <span>{o.nameLabel}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={o.namePlaceholder}
              maxLength={30}
              aria-invalid={nameProblem !== null}
            />
          </label>
          <FieldHint problem={nameProblem} field="displayName" f={f} />
        </section>
      )}

      <footer className="ob-foot">
        {step > 1 && (
          <button className="btn ghost" onClick={() => setStep((s) => s - 1)}>
            {ui.common.back}
          </button>
        )}
        {step < STEPS ? (
          <button className="btn primary" disabled={step === 2 && count === 0} onClick={() => setStep((s) => s + 1)}>
            {ui.common.next}
          </button>
        ) : (
          <button className="btn primary forge" onClick={finish} disabled={whyProblem !== null || nameProblem !== null}>
            🔥 {o.start}
          </button>
        )}
      </footer>
    </div>
  );
}
