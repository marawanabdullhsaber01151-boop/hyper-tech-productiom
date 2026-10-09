import type { ComponentChildren, JSX } from "preact";
import { useId, useState } from "preact/hooks";
import { t } from "../../copy";
import { normalizeEgyptPhone, toLatinDigits } from "../../lib/phone";
import { Eye, EyeOff } from "../icons";
import { IconButton } from "./Button";
import { useFieldCtx } from "./Field";
import { cx } from "./util";

function useA11y(props: { id?: string; invalid?: boolean; required?: boolean; disabled?: boolean; "aria-describedby"?: string }) {
  const f = useFieldCtx();
  return {
    id: props.id ?? f?.id,
    "aria-describedby": props["aria-describedby"] ?? f?.describedBy,
    "aria-invalid": (props.invalid ?? f?.invalid) ? ("true" as const) : undefined,
    required: props.required ?? f?.required,
    disabled: props.disabled ?? f?.disabled,
  };
}

type InputProps = Omit<JSX.IntrinsicElements["input"], "size"> & { invalid?: boolean };

export function Input({ invalid, class: cls, ...rest }: InputProps) {
  const a = useA11y({ ...rest, invalid } as never);
  return <input {...(rest as any)} {...(a as any)} class={cx("ht-control", cls as string)} />;
}

export function Textarea({ invalid, class: cls, rows = 4, ...rest }: Omit<JSX.IntrinsicElements["textarea"], "size"> & { invalid?: boolean }) {
  const a = useA11y({ ...rest, invalid } as never);
  return <textarea {...(rest as any)} {...(a as any)} rows={rows} class={cx("ht-control ht-control--area", cls as string)} />;
}

export interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}
export function Select({ options, placeholder, invalid, class: cls, ...rest }: Omit<JSX.IntrinsicElements["select"], "size"> & { options: Option[]; placeholder?: string; invalid?: boolean }) {
  const a = useA11y({ ...rest, invalid } as never);
  return (
    <span class="ht-select">
      <select {...(rest as any)} {...(a as any)} class={cx("ht-control", cls as string)}>
        {placeholder ? (
          <option value="" disabled selected={rest.value === undefined || rest.value === ""}>
            {placeholder}
          </option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

interface ChoiceProps extends Omit<JSX.IntrinsicElements["input"], "label" | "size"> {
  label: ComponentChildren;
  hint?: string;
}

export function Checkbox({ label, hint, class: cls, ...rest }: ChoiceProps) {
  const id = useId();
  return (
    <label class={cx("ht-choice", cls as string)} for={rest.id ?? id}>
      <input {...(rest as any)} id={rest.id ?? id} type="checkbox" class="ht-choice__input" />
      <span class="ht-choice__box" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="12" height="12">
          <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
      <span class="ht-choice__text">
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
    </label>
  );
}

export function Radio({ label, hint, class: cls, ...rest }: ChoiceProps) {
  const id = useId();
  return (
    <label class={cx("ht-choice ht-choice--radio", cls as string)} for={rest.id ?? id}>
      <input {...(rest as any)} id={rest.id ?? id} type="radio" class="ht-choice__input" />
      <span class="ht-choice__box" aria-hidden="true" />
      <span class="ht-choice__text">
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
    </label>
  );
}

export function Switch({ label, hint, checked, onChange, disabled, class: cls }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; class?: string }) {
  const id = useId();
  return (
    <div class={cx("ht-switch", cls)}>
      <span class="ht-switch__text">
        <span id={`${id}-l`}>{label}</span>
        {hint ? <small>{hint}</small> : null}
      </span>
      <button type="button" role="switch" aria-checked={checked} aria-labelledby={`${id}-l`} disabled={disabled} class="ht-switch__track" onClick={() => onChange(!checked)}>
        <span class="ht-switch__thumb" />
      </button>
    </div>
  );
}

export function PasswordInput({ class: cls, invalid, ...rest }: InputProps) {
  const [shown, setShown] = useState(false);
  const a = useA11y({ ...rest, invalid } as never);
  return (
    <span class="ht-affix">
      <input {...(rest as any)} {...(a as any)} type={shown ? "text" : "password"} dir="ltr" class={cx("ht-control ht-control--ltr", cls as string)} autocomplete={rest.autocomplete ?? "current-password"} />
      <IconButton class="ht-affix__btn" size="sm" icon={shown ? EyeOff : Eye} label={shown ? t("common.hidePassword") : t("common.showPassword")} onClick={() => setShown((s) => !s)} />
    </span>
  );
}

export interface PhoneInputProps {
  value: string;
  onChange: (raw: string, normalized: string | null) => void;
  invalid?: boolean;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
}

/** بيقبل أرقام عربية و+20، وبيعرض 01XXXXXXXXX بشكل LTR. */
export function PhoneInput({ value, onChange, invalid, ...rest }: PhoneInputProps) {
  const a = useA11y({ ...rest, invalid });
  return (
    <span class="ht-affix ht-affix--lead">
      <span class="ht-affix__tag" aria-hidden="true" dir="ltr">
        +20
      </span>
      <input
        {...a}
        name={rest.name}
        type="tel"
        inputMode="numeric"
        autocomplete="tel-national"
        dir="ltr"
        class="ht-control ht-control--ltr"
        value={value}
        onInput={(e) => {
          const raw = toLatinDigits((e.currentTarget as HTMLInputElement).value).replace(/[^\d+\s-]/g, "");
          onChange(raw, normalizeEgyptPhone(raw));
        }}
      />
    </span>
  );
}
