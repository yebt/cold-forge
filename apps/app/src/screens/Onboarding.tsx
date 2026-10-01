import { HABIT_TEMPLATES, type HabitTemplateId, type ISODate } from "@cold-forge/core";
import { LOCALES, LOCALE_NAMES, type Locale } from "@cold-forge/i18n";
import { useMemo, useState, type FormEvent } from "react";
import { formatShortDate, getTranslations } from "../i18n/index.ts";
import { arcOptions, type ArcOption } from "../lib/derive.ts";
import { TEXT_LIMITS, type NewHabitInput, type OnboardingInput } from "../lib/model.ts";
import { checkEmoji, checkField } from "../lib/fields.ts";
import { EmojiField } from "../ui/EmojiField.tsx";
import { FieldHint } from "../ui/FieldHint.tsx";
import { HABIT_ICONS, Icon } from "../ui/Icon.tsx";

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
  const [showCustom, setShowCustom] = useState(false);

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

  const canNext = !(step === 2 && count === 0);

  return (
    <div className="onboarding">
      <header className="ob-head">
        {step > 1 ? (
          <button type="button" className="icon-btn" aria-label={ui.common.back} onClick={() => setStep((s) => s - 1)}>
            <Icon name="back" size={18} strokeWidth={2} />
          </button>
        ) : (
          <span className="ob-brand">COLD FORGE</span>
        )}
        <div
          className="ob-progress"
          role="progressbar"
          aria-label={o.stepOf(step, STEPS)}
          aria-valuemin={1}
          aria-valuemax={STEPS}
          aria-valuenow={step}
        >
          {Array.from({ length: STEPS }, (_, i) => (
            <span key={i} className={i < step ? "on" : ""} />
          ))}
        </div>
        <span className="ob-head-spacer" aria-hidden="true" />
      </header>

      <div className="ob-body">
        <span className="label">{o.stepOf(step, STEPS)}</span>

        {step === 1 && (
          <section className="ob-step">
            <div className="ob-lang">
              <span className="section-label" id="ob-lang-label">
                {o.language}
              </span>
              <div className="chip-row" role="radiogroup" aria-labelledby="ob-lang-label">
                {LOCALES.map((l) => (
                  <button
                    key={l}
                    type="button"
                    role="radio"
                    aria-checked={l === locale}
                    className={`chip${l === locale ? " on" : ""}`}
                    onClick={() => setLocale(l)}
                    lang={l}
                  >
                    {LOCALE_NAMES[l]}
                  </button>
                ))}
              </div>
            </div>
            <h1 className="display-title">{o.arcTitle}</h1>
            <p className="lead">
              <span className="ob-kicker">{o.welcome}</span> {o.arcLead}
            </p>
            <div className="arc-options" role="radiogroup" aria-label={o.arcTitle}>
              <button
                type="button"
                role="radio"
                aria-checked={arc.kind === "winter"}
                className={`arc-option${arc.kind === "winter" ? " on" : ""}`}
                onClick={() => setArc(options.winter)}
              >
                <span className="arc-icon">
                  <Icon name="snow" size={22} />
                </span>
                <span className="arc-text">
                  <strong>{o.winterTitle(year)}</strong>
                  <span>
                    {options.winter.status === "upcoming"
                      ? o.winterUpcoming(options.winter.startsIn)
                      : o.winterActive(options.winter.day)}
                  </span>
                </span>
                <span className="radio-dot" aria-hidden="true" />
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={arc.kind === "custom"}
                className={`arc-option${arc.kind === "custom" ? " on" : ""}`}
                onClick={() => setArc(options.custom)}
              >
                <span className="arc-icon">
                  <Icon name="calendar" size={22} />
                </span>
                <span className="arc-text">
                  <strong>{o.customTitleOpt}</strong>
                  <span>{o.customSub(formatShortDate(options.custom.window.endDate, locale))}</span>
                </span>
                <span className="radio-dot" aria-hidden="true" />
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="ob-step">
            <h1 className="display-title">{o.habitsTitle}</h1>
            <p className="lead">{o.habitsLead}</p>
            <div className="chip-row">
              {HABIT_TEMPLATES.map((t) => {
                const on = picked.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={`chip${on ? " on" : ""}`}
                    aria-pressed={on}
                    onClick={() => toggle(t.id)}
                  >
                    <Icon name={HABIT_ICONS[t.id]} size={16} />
                    {m.habits[t.id]}
                  </button>
                );
              })}
              {custom.map((c, i) => (
                <button
                  key={`c${i}`}
                  type="button"
                  className="chip on"
                  aria-pressed="true"
                  onClick={() => setCustom((list) => list.filter((_, j) => j !== i))}
                >
                  <span aria-hidden="true">{c.emoji}</span>
                  {c.name}
                  <Icon name="close" size={14} strokeWidth={2.2} />
                </button>
              ))}
              {!showCustom && (
                <button type="button" className="chip dashed" aria-expanded={false} onClick={() => setShowCustom(true)}>
                  <Icon name="plus" size={16} strokeWidth={2} />
                  {o.createOwn}
                </button>
              )}
            </div>
            {showCustom && (
              <>
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
                    autoFocus
                  />
                  <button type="submit" className="btn secondary" disabled={customProblem !== null}>
                    {ui.common.add}
                  </button>
                </form>
                <FieldHint problem={customName === "" ? null : customProblem} field="name" f={f} />
              </>
            )}
          </section>
        )}

        {step === 3 && (
          <section className="ob-step">
            <h1 className="display-title">{o.whyTitle}</h1>
            <p className="lead">{o.whyLead}</p>
            <textarea
              className="why-input"
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              placeholder={o.whyPlaceholder}
              aria-label={o.whyTitle}
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
      </div>

      <footer className="ob-foot">
        {step === 2 && (
          <span className="ob-count" role="status">
            {count > 0 ? o.selected(count) : o.pickOne}
          </span>
        )}
        {step < STEPS ? (
          <button type="button" className="btn primary block" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
            {ui.common.next}
          </button>
        ) : (
          <button
            type="button"
            className="btn primary block"
            onClick={finish}
            disabled={whyProblem !== null || nameProblem !== null}
          >
            <Icon name="flame" size={18} strokeWidth={2} />
            {o.start}
          </button>
        )}
      </footer>
    </div>
  );
}
