import type { ComponentChildren } from "preact";
import { useId, useRef, useState } from "preact/hooks";
import { t } from "../../copy";
import { formatNumber } from "../../lib/format";
import { cx } from "./util";

/* ---------- Card / Section ---------- */
export function Card({ children, class: cls, as: Tag = "div", pad = true, ...rest }: { children?: ComponentChildren; class?: string; as?: "div" | "section" | "article" | "li"; pad?: boolean; [k: string]: unknown }) {
  return (
    <Tag {...rest} class={cx("ht-card", pad && "ht-card--pad", cls)}>
      {children}
    </Tag>
  );
}

/** عنوان قسم بمسطرة قياس رفيعة (ruler ticks) — توقيع الهوية البصرية. */
export function Section({ title, description, actions, children, class: cls }: { title: string; description?: string; actions?: ComponentChildren; children?: ComponentChildren; class?: string }) {
  const id = useId();
  return (
    <section class={cx("ht-section", cls)} aria-labelledby={id}>
      <header class="ht-section__head">
        <div>
          <h2 id={id} class="ht-section__title">
            {title}
          </h2>
          {description ? <p class="ht-section__desc">{description}</p> : null}
        </div>
        {actions ? <div class="ht-section__actions">{actions}</div> : null}
      </header>
      <div class="ht-ruler" aria-hidden="true" />
      <div class="ht-section__body">{children}</div>
    </section>
  );
}

/* ---------- Tabs ---------- */
export interface TabDef {
  id: string;
  label: string;
  badge?: number;
  panel: ComponentChildren;
}
export function Tabs({ tabs, value, onChange, label = t("tabs.label") }: { tabs: TabDef[]; value: string; onChange: (id: string) => void; label?: string }) {
  const base = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const idx = Math.max(0, tabs.findIndex((x) => x.id === value));
  const onKey = (e: KeyboardEvent) => {
    // RTL: السهم اليمين = السابق (الاتجاه البصري)
    const rtl = getComputedStyle(e.currentTarget as HTMLElement).direction === "rtl";
    let n = idx;
    if (e.key === (rtl ? "ArrowLeft" : "ArrowRight")) n = (idx + 1) % tabs.length;
    else if (e.key === (rtl ? "ArrowRight" : "ArrowLeft")) n = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = tabs.length - 1;
    else return;
    e.preventDefault();
    onChange(tabs[n]!.id);
    refs.current[n]?.focus();
  };
  return (
    <div class="ht-tabs">
      <div role="tablist" aria-label={label} class="ht-tabs__list" onKeyDown={onKey}>
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            ref={(el) => { refs.current[i] = el; }}
            role="tab"
            type="button"
            id={`${base}-t-${tab.id}`}
            aria-selected={tab.id === value}
            aria-controls={`${base}-p-${tab.id}`}
            tabIndex={tab.id === value ? 0 : -1}
            class="ht-tabs__tab"
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
            {tab.badge ? <span class="ht-tabs__badge">{formatNumber(tab.badge)}</span> : null}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.id} role="tabpanel" id={`${base}-p-${tab.id}`} aria-labelledby={`${base}-t-${tab.id}`} hidden={tab.id !== value} class="ht-tabs__panel" tabIndex={0}>
          {tab.id === value ? tab.panel : null}
        </div>
      ))}
    </div>
  );
}

/* ---------- StatusPill (LED) ---------- */
export type Tone = "neutral" | "brand" | "success" | "warn" | "danger" | "info";
export function StatusPill({ tone = "neutral", children, pulse }: { tone?: Tone; children: ComponentChildren; pulse?: boolean }) {
  return (
    <span class={cx("ht-pill", `ht-pill--${tone}`)}>
      <span class={cx("ht-led", pulse && "ht-led--pulse")} aria-hidden="true" />
      {children}
    </span>
  );
}

/* ---------- Stat ---------- */
export function Stat({ label, value, hint, tone = "neutral" }: { label: string; value: ComponentChildren; hint?: string; tone?: Tone }) {
  return (
    <div class={cx("ht-stat", `ht-stat--${tone}`)}>
      <div class="ht-stat__label">{label}</div>
      <div class="ht-stat__value num">{value}</div>
      {hint ? <div class="ht-stat__hint">{hint}</div> : null}
    </div>
  );
}

/* ---------- Avatar ---------- */
function hueOf(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
export function Avatar({ name, size = 36 }: { name: string; size?: 28 | 36 | 48 }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => Array.from(w)[0] ?? "").join("");
  return (
    <span class="ht-avatar" style={{ "--av-h": hueOf(name), inlineSize: size, blockSize: size, fontSize: size * 0.38 } as never} role="img" aria-label={name}>
      {initials}
    </span>
  );
}

/* ---------- Timeline ---------- */
export interface TimelineItem {
  id: string | number;
  title: string;
  meta?: string;
  body?: string;
  tone?: Tone;
}
export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol class="ht-timeline">
      {items.map((it) => (
        <li key={it.id} class={cx("ht-timeline__item", `ht-timeline__item--${it.tone ?? "neutral"}`)}>
          <span class="ht-timeline__dot" aria-hidden="true" />
          <div class="ht-timeline__title">{it.title}</div>
          {it.meta ? <div class="ht-timeline__meta">{it.meta}</div> : null}
          {it.body ? <p class="ht-timeline__body">{it.body}</p> : null}
        </li>
      ))}
    </ol>
  );
}

/* ---------- EmptyState (blueprint) ---------- */
export function EmptyState({ title = t("empty.title"), description, action, compact }: { title?: string; description?: string; action?: ComponentChildren; compact?: boolean }) {
  return (
    <div class={cx("ht-empty", compact && "ht-empty--compact")}>
      <svg class="ht-empty__art" viewBox="0 0 160 110" aria-hidden="true" focusable="false">
        <defs>
          <pattern id="ht-grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M10 0H0V10" fill="none" stroke="currentColor" stroke-width=".5" opacity=".35" />
          </pattern>
        </defs>
        <rect x="1" y="1" width="158" height="108" rx="10" fill="url(#ht-grid)" stroke="currentColor" stroke-width="1" opacity=".6" />
        <rect x="42" y="30" width="76" height="50" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3" />
        <path d="M42 44h76M58 30v50" stroke="currentColor" stroke-width="1" opacity=".5" />
        <path d="M30 90h18M30 90v-8M112 20h18M130 20v8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
      <h3 class="ht-empty__title">{title}</h3>
      {description ? <p class="ht-empty__desc">{description}</p> : null}
      {action ? <div class="ht-empty__action">{action}</div> : null}
    </div>
  );
}

/* ---------- Skeleton / ProgressBar ---------- */
export function Skeleton({ width, height = 14, radius, lines }: { width?: string | number; height?: number; radius?: string; lines?: number }) {
  if (lines && lines > 1) {
    return (
      <div class="ht-skel-stack" aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} class="ht-skel" style={{ blockSize: height, inlineSize: i === lines - 1 ? "60%" : "100%" }} />
        ))}
      </div>
    );
  }
  return <span class="ht-skel" aria-hidden="true" style={{ inlineSize: width ?? "100%", blockSize: height, borderRadius: radius }} />;
}

export function ProgressBar({ value, max = 100, label, tone = "brand" }: { value: number; max?: number; label: string; tone?: Tone }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div class={cx("ht-progress", `ht-progress--${tone}`)} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(value)}>
      <span class="ht-progress__bar" style={{ inlineSize: `${pct}%` }} />
    </div>
  );
}

/* ---------- Alerts ---------- */
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "../icons";
import { Icon } from "./Icon";
import { IconButton } from "./Button";

const ALERT_ICON = { info: Info, success: CircleCheck, warn: TriangleAlert, danger: CircleAlert } as const;
type AlertTone = keyof typeof ALERT_ICON;

export function InlineAlert({ tone = "info", title, children, action }: { tone?: AlertTone; title?: string; children?: ComponentChildren; action?: ComponentChildren }) {
  return (
    <div class={cx("ht-alert", `ht-alert--${tone}`)} role={tone === "danger" || tone === "warn" ? "alert" : "status"}>
      <Icon icon={ALERT_ICON[tone]} size={20} class="ht-alert__icon" />
      <div class="ht-alert__body">
        {title ? <strong class="ht-alert__title">{title}</strong> : null}
        {children ? <div>{children}</div> : null}
      </div>
      {action ? <div class="ht-alert__action">{action}</div> : null}
    </div>
  );
}

/** شريط أعلى الصفحة (إعلان / وضع قراءة بس…) وممكن يتقفل. */
export function Banner({ tone = "info", children, onDismiss }: { tone?: AlertTone; children: ComponentChildren; onDismiss?: () => void }) {
  return (
    <div class={cx("ht-banner", `ht-banner--${tone}`)} role="status">
      <Icon icon={ALERT_ICON[tone]} size={18} />
      <div class="ht-banner__text">{children}</div>
      {onDismiss ? <IconButton icon={X} size="sm" label={t("common.close")} onClick={onDismiss} /> : null}
    </div>
  );
}

/* ---------- Toasts ---------- */
import { createContext } from "preact";
import { useCallback, useContext } from "preact/hooks";

export interface ToastInput {
  tone?: AlertTone;
  message: string;
  /** بالمللي ثانية. 0 = ما يختفيش لوحده. الأخطاء ما بتختفيش افتراضيًا. */
  duration?: number;
}
interface ToastItem extends ToastInput {
  id: number;
}
const ToastCtx = createContext<{ push: (t: ToastInput) => void } | null>(null);
export const useToast = () => {
  const c = useContext(ToastCtx);
  if (!c) throw new Error("useToast must be used inside ToastProvider");
  return c.push;
};

export function ToastProvider({ children }: { children: ComponentChildren }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const remove = useCallback((id: number) => setItems((l) => l.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (ti: ToastInput) => {
      const id = next.current++;
      setItems((l) => [...l.slice(-3), { ...ti, id }]);
      const d = ti.duration ?? (ti.tone === "danger" ? 0 : 4500);
      if (d > 0) setTimeout(() => remove(id), d);
    },
    [remove],
  );
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div class="ht-toasts" role="region" aria-label={t("toast.region")}>
        {items.map((it) => (
          <div key={it.id} class={cx("ht-toast", `ht-toast--${it.tone ?? "info"}`)} role={it.tone === "danger" ? "alert" : "status"}>
            <Icon icon={ALERT_ICON[it.tone ?? "info"]} size={20} />
            <span class="ht-toast__msg">{it.message}</span>
            <IconButton icon={X} size="sm" label={t("toast.dismiss")} onClick={() => remove(it.id)} />
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

