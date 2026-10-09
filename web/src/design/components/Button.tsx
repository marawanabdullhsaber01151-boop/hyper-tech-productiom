import type { ComponentChildren, JSX } from "preact";
import { Icon } from "./Icon";
import { Spinner } from "./Spinner";
import { cx } from "./util";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "sm" | "lg";

export interface ButtonProps extends Omit<JSX.IntrinsicElements["button"], "size"> {
  variant?: Variant;
  size?: Size;
  icon?: Parameters<typeof Icon>[0]["icon"];
  loading?: boolean;
  block?: boolean;
  children?: ComponentChildren;
}

export function Button({ variant = "primary", size = "md", icon, loading, block, disabled, class: cls, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      class={cx("ht-btn", `ht-btn--${variant}`, size !== "md" && `ht-btn--${size}`, block && "ht-btn--block", cls as string)}
      disabled={disabled || loading}
      aria-busy={loading ? "true" : undefined}
    >
      {loading ? <Spinner /> : icon ? <Icon icon={icon} size={18} /> : null}
      <span class="ht-btn__label">{children}</span>
    </button>
  );
}

export interface IconButtonProps extends Omit<JSX.IntrinsicElements["button"], "size"> {
  icon: Parameters<typeof Icon>[0]["icon"];
  /** إجباري: اسم الزر لقارئ الشاشة والـ tooltip. */
  label: string;
  variant?: "ghost" | "secondary" | "danger";
  size?: "md" | "sm";
  flip?: boolean;
}

export function IconButton({ icon, label, variant = "ghost", size = "md", flip, class: cls, type = "button", ...rest }: IconButtonProps) {
  return (
    <button {...rest} type={type} class={cx("ht-iconbtn", `ht-iconbtn--${variant}`, size === "sm" && "ht-iconbtn--sm", cls as string)} aria-label={label} title={label}>
      <Icon icon={icon} size={size === "sm" ? 16 : 20} flip={flip} />
    </button>
  );
}
