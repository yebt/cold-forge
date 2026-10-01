import type { FieldProblem, TextField } from "../lib/fields.ts";
import { FIELD_MAX } from "../lib/fields.ts";
import type { UiMessages } from "../i18n/index.ts";

/** Friendly, localized reason a text field can't be saved. */
export function FieldHint({ problem, field, f }: { problem: FieldProblem | null; field: TextField; f: UiMessages["fields"] }) {
  if (!problem) return null;
  const text = problem === "blank" ? f.blank : problem === "tooLong" ? f.tooLong(FIELD_MAX[field]) : f.invalid;
  return (
    <p className="field-hint" role="alert">
      {text}
    </p>
  );
}
