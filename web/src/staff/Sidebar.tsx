import { t } from "../copy";
import { Icon } from "../design/components";
import { House } from "../design/icons";
import { Link } from "../app/router";
import { isActiveHref, iconFor, resolveHref, type NavResponse } from "./nav";

interface Props {
  nav: NavResponse;
  path: string;
  collapsed: boolean;
  openDept: string | null;
  onToggleDept: (id: string) => void;
  onNavigate?: () => void;
}

/** سايدبار واحد بيتبني من /nav: قسم ← محور ← صفحة. */
export function Sidebar({ nav, path, collapsed, openDept, onToggleDept, onNavigate }: Props) {
  const home = (
    <li class="st-dept">
      <Link
        to="/staff"
        class="st-dept__btn st-home-link"
        aria-current={path === "/staff" ? "page" : undefined}
        aria-label={collapsed ? t("staff.nav.home") : undefined}
      >
        <Icon icon={House} size={20} />
        {collapsed ? null : <span class="st-dept__label">{t("staff.nav.home")}</span>}
      </Link>
    </li>
  );
  if (nav.departments.length === 0) {
    return (
      <nav class="st-nav" aria-label={t("staff.nav.label")}>
        <ul class="st-nav__list">{home}</ul>
        <p class="st-side__empty">{t("staff.nav.empty")}</p>
      </nav>
    );
  }
  return (
    <nav class="st-nav" aria-label={t("staff.nav.label")}>
      <ul class="st-nav__list">
        {home}
        {nav.departments.map((d) => {
          const hasActive = d.subFunctions.some((s) => s.pages.some((p) => isActiveHref(path, p.href)));
          // المطوي: الأيقونات بس. المفتوح: القسم اللي عليه الدور أو اللي المستخدم فتحه.
          const open = !collapsed && (openDept === d.id || (openDept === null && hasActive));
          return (
            <li key={d.id} class="st-dept">
              <button
                type="button"
                class="st-dept__btn"
                aria-expanded={collapsed ? undefined : open}
                aria-controls={`st-dept-${d.id}`}
                data-active={hasActive ? "true" : undefined}
                title={collapsed ? d.label : undefined}
                aria-label={collapsed ? d.label : undefined}
                onClick={() => onToggleDept(d.id)}
              >
                <Icon icon={iconFor(d.icon)} size={20} />
                {collapsed ? null : <span class="st-dept__label">{d.label}</span>}
              </button>
              {open ? (
                <div id={`st-dept-${d.id}`} class="st-dept__body">
                  {d.subFunctions.map((s) => (
                    <div key={s.id} class="st-sub">
                      <div class="st-sub__title">{s.label}</div>
                      <ul class="st-sub__list">
                        {s.pages.map((p) => {
                          const r = resolveHref(p.href);
                          const active = isActiveHref(path, p.href);
                          const badge = p.badgeCount && p.badgeCount > 0 ? <span class="st-badge">{p.badgeCount}</span> : null;
                          return (
                            <li key={p.id}>
                              {r.kind === "spa" ? (
                                <Link to={r.to} class="st-link" aria-current={active ? "page" : undefined}>
                                  <span class="st-link__label">{p.label}</span>
                                  {badge}
                                </Link>
                              ) : (
                                <a class="st-link" href={r.href} onClick={onNavigate}>
                                  <span class="st-link__label">{p.label}</span>
                                  {badge}
                                </a>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
