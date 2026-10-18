import { useContext, useEffect } from "preact/hooks";
import { Link, navigate } from "../app/router";
import { t } from "../copy";
import { EmptyState, Icon, Spinner } from "../design/components";
import { NavContext } from "./NavContext";
import { deptPageCount, iconFor, resolveHref } from "./nav";

/** الرئيسية: قسم واحد ← تحويل مباشر، غير كده شبكة أقسام. */
export function Home() {
  const nav = useContext(NavContext);
  useEffect(() => {
    if (!nav || !nav.singleDepartment || !nav.homeHref) return;
    const r = resolveHref(nav.homeHref);
    if (r.kind === "spa") navigate(r.to, { replace: true });
    else location.replace(r.href);
  }, [nav]);

  if (!nav) return <Spinner />;
  if (nav.singleDepartment && nav.homeHref) return <Spinner />;
  if (nav.departments.length === 0) return <div class="ad-page"><EmptyState title={t("staff.nav.empty")} /></div>;
  return (
    <div class="st-home">
      <h1 class="ad-title">{nav.user ? t("staff.home.hello", { name: nav.user.name }) : t("staff.home.title")}</h1>
      <div class="st-home__grid">
        {nav.departments.map((d) => {
          const first = d.subFunctions[0]?.pages[0];
          const r = first ? resolveHref(first.href) : null;
          const body = (
            <>
              <span class="st-card__icon"><Icon icon={iconFor(d.icon)} size={32} /></span>
              <span class="st-card__title">{d.label}</span>
              <span class="st-card__meta">{t("staff.home.pages", { n: deptPageCount(d) })}</span>
            </>
          );
          if (!r) return <div key={d.id} class="st-card">{body}</div>;
          return r.kind === "spa" ? (
            <Link key={d.id} to={r.to} class="st-card">{body}</Link>
          ) : (
            <a key={d.id} class="st-card" href={r.href}>{body}</a>
          );
        })}
      </div>
    </div>
  );
}
