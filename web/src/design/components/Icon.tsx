import type { ComponentType } from "preact";
import { cx } from "./util";

type LucideLike = ComponentType<{ size?: number | string; strokeWidth?: number | string; class?: string; "aria-hidden"?: boolean | "true" }>;

export interface IconProps {
  icon: LucideLike;
  size?: 14 | 16 | 18 | 20 | 24 | 32 | 48;
  /** أيقونات الاتجاه (سهم/شيفرون) بتتعكس في RTL. */
  flip?: boolean;
  /** لو الأيقونة لوحدها ومعنى — اديها label، غير كده بتتخفي عن قارئ الشاشة. */
  label?: string;
  class?: string;
}

export function Icon({ icon: C, size = 20, flip, label, class: cls }: IconProps) {
  return (
    <span class={cx("ht-icon", flip && "ht-icon--flip", cls)} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : "true"}>
      <C size={size} strokeWidth={1.75} aria-hidden="true" />
    </span>
  );
}
