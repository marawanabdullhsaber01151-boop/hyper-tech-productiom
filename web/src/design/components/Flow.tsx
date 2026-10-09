import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";
import { t } from "../../copy";
import { formatNumber } from "../../lib/format";
import { Check } from "../icons";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { cx } from "./util";

/* ---------- StepWizard ---------- */
export interface WizardStep {
  id: string;
  title: string;
  content: ComponentChildren;
  /** بيمنع "التالي" لحد ما الخطوة تكمل. */
  valid?: boolean;
}
export function StepWizard({ steps, current, onChange, onFinish, finishing, finishLabel = t("steps.finish") }: { steps: WizardStep[]; current: number; onChange: (i: number) => void; onFinish: () => void; finishing?: boolean; finishLabel?: string }) {
  const step = steps[current]!;
  const last = current === steps.length - 1;
  return (
    <div class="ht-wizard">
      <ol class="ht-wizard__rail" aria-label={t("steps.progress", { n: formatNumber(current + 1), total: formatNumber(steps.length) })}>
        {steps.map((s, i) => (
          <li key={s.id} class={cx("ht-wizard__dot", i < current && "is-done", i === current && "is-current")} aria-current={i === current ? "step" : undefined}>
            <span class="ht-wizard__n" aria-hidden="true">{i < current ? <Icon icon={Check} size={14} /> : formatNumber(i + 1)}</span>
            <span class="ht-wizard__t">{s.title}</span>
          </li>
        ))}
      </ol>
      <div class="ht-wizard__body" aria-live="polite">{step.content}</div>
      <div class="ht-wizard__nav">
        <Button variant="ghost" disabled={current === 0} onClick={() => onChange(current - 1)}>
          {t("steps.back")}
        </Button>
        {last ? (
          <Button loading={finishing} disabled={step.valid === false} onClick={onFinish}>
            {finishLabel}
          </Button>
        ) : (
          <Button disabled={step.valid === false} onClick={() => onChange(current + 1)}>
            {t("steps.next")}
          </Button>
        )}
      </div>
    </div>
  );
}

/* ---------- PermissionMatrix ---------- */
export interface PermItem {
  key: string;
  label: string;
  hint?: string;
  /** مقفولة: العضو الحالي مايقدرش يديها (anti-escalation). */
  locked?: boolean;
}
export interface PermGroup {
  id: string;
  label: string;
  items: PermItem[];
}
export function PermissionMatrix({ groups, value, onChange, readOnly }: { groups: PermGroup[]; value: ReadonlySet<string>; onChange: (next: Set<string>) => void; readOnly?: boolean }) {
  const base = useId();
  const toggle = (k: string, on: boolean) => {
    const n = new Set(value);
    if (on) n.add(k);
    else n.delete(k);
    onChange(n);
  };
  const setGroup = (g: PermGroup, on: boolean) => {
    const n = new Set(value);
    g.items.filter((i) => !i.locked).forEach((i) => (on ? n.add(i.key) : n.delete(i.key)));
    onChange(n);
  };
  return (
    <div class="ht-perm" role="group" aria-label={t("perm.matrix.label")}>
      {groups.map((g) => {
        const free = g.items.filter((i) => !i.locked);
        const on = free.filter((i) => value.has(i.key)).length;
        const all = free.length > 0 && on === free.length;
        return (
          <fieldset key={g.id} class="ht-perm__group">
            <legend class="ht-perm__legend">
              {g.label}
              {!readOnly && free.length ? (
                <button type="button" class="ht-linkbtn" onClick={() => setGroup(g, !all)}>
                  {all ? t("perm.matrix.none") : t("perm.matrix.all")}
                </button>
              ) : null}
            </legend>
            {g.items.map((it) => {
              const id = `${base}-${it.key}`;
              const checked = value.has(it.key);
              return (
                <label key={it.key} for={id} class={cx("ht-perm__row", it.locked && "is-locked")}>
                  <input id={id} type="checkbox" class="ht-choice__input" checked={checked} disabled={readOnly || it.locked} onChange={(e) => toggle(it.key, (e.currentTarget as HTMLInputElement).checked)} />
                  <span class="ht-choice__box" aria-hidden="true">
                    <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
                  </span>
                  <span class="ht-choice__text">
                    {it.label}
                    {it.hint ? <small>{it.hint}</small> : null}
                    {it.locked ? <small>{t("perm.matrix.locked")}</small> : null}
                  </span>
                </label>
              );
            })}
          </fieldset>
        );
      })}
    </div>
  );
}
