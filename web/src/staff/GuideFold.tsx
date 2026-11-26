import "../copy/guide7";
import type { ComponentChildren } from "preact";
import { t } from "../copy";
import { Button } from "../design/components";

/** بيفتح العنصر وكل اللي فوقه من العناصر المطوية، وبعدين بينزل عليه. */
export function jumpTo(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  for (let n: HTMLElement | null = el; n; n = n.parentElement) if (n instanceof HTMLDetailsElement) n.open = true;
  el.scrollIntoView?.({ behavior: "smooth", block: "start" });
}

/** بيفتح أو بيقفل كل العناصر المطوية جوه حاوية معيّنة. */
export function setAll(scopeId: string, open: boolean): void {
  document.getElementById(scopeId)?.querySelectorAll<HTMLDetailsElement>("details.gd-fold").forEach((d) => {
    d.open = open;
  });
}

/**
 * عنصر مطوي (details/summary الأصلية: بتشتغل بلوحة المفاتيح وقارئ الشاشة من غير كود).
 * العنوان بيفضل ظاهر دايمًا جوه الـsummary، والتفاصيل بتتفتح بالضغط.
 */
export function Fold({ id, level = 1, title, meta, sub, open, children }: { id?: string; level?: 1 | 2; title: string; meta?: string; sub?: string; open?: boolean; children?: ComponentChildren }) {
  const Heading = level === 1 ? "h3" : "h4";
  return (
    <details class={`gd-fold gd-fold--l${level}`} id={id} open={open}>
      <summary>
        <span class="gd-fold__head">
          <Heading class="gd-fold__t">{title}</Heading>
          {sub ? <span class="gd-fold__sub">{sub}</span> : null}
        </span>
        {meta ? <small class="gd-fold__meta">{meta}</small> : null}
      </summary>
      <div class="gd-fold__body">{children}</div>
    </details>
  );
}

/** تلميح + «افتح الكل / اقفل الكل» لحاوية الطي. */
export function FoldTools({ scope }: { scope: string }) {
  return (
    <div class="gd-foldtools">
      <p class="gd-muted">{t("guide.fold.hint")}</p>
      <div class="gd-foldtools__btns">
        <Button size="sm" variant="secondary" onClick={() => setAll(scope, true)}>{t("guide.fold.openAll")}</Button>
        <Button size="sm" variant="ghost" onClick={() => setAll(scope, false)}>{t("guide.fold.closeAll")}</Button>
      </div>
    </div>
  );
}

/** شرايح للقفز لعنصر معيّن (بتفتحه وتنزل عليه). */
export function JumpBar({ items, label }: { items: readonly { id: string; label: string }[]; label?: string }) {
  if (items.length < 2) return null;
  return (
    <nav class="gd-jump" aria-label={label ?? t("guide.fold.jump")}>
      <span class="gd-muted">{t("guide.fold.jump")}</span>
      {items.map((i) => (
        <button type="button" class="gd-jump__chip" key={i.id} onClick={() => jumpTo(i.id)}>{i.label}</button>
      ))}
    </nav>
  );
}
