import { createContext, type ComponentChildren } from "preact";
import { useContext, useMemo } from "preact/hooks";
import { t } from "../../copy";
import { cx, uid } from "./util";

export interface FieldCtx {
  id: string;
  describedBy?: string;
  invalid: boolean;
  required: boolean;
  disabled: boolean;
}
const Ctx = createContext<FieldCtx | null>(null);
export const useFieldCtx = () => useContext(Ctx);

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  optional?: boolean;
  disabled?: boolean;
  class?: string;
  children: ComponentChildren;
}

/** label + hint + error بتتربط بالـ input تلقائيًا (for / aria-describedby / aria-invalid). */
export function Field({ label, hint, error, required, optional, disabled, class: cls, children }: FieldProps) {
  const id = useMemo(() => uid("fld"), []);
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = [error ? errId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div class={cx("ht-field", error && "is-invalid", cls)}>
      <label class="ht-field__label" for={id}>
        {label}
        {required ? <span class="ht-field__req" aria-hidden="true">*</span> : null}
        {required ? <span class="sr-only"> {t("a11y.required")}</span> : null}
        {optional && !required ? <span class="ht-field__opt">{t("common.optional")}</span> : null}
      </label>
      <Ctx.Provider value={{ id, describedBy, invalid: !!error, required: !!required, disabled: !!disabled }}>{children}</Ctx.Provider>
      {hint && !error ? (
        <p class="ht-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p class="ht-field__error" id={errId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
