import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { api } from "../admin/api";
import { goStaffLogin, staffUser } from "../admin/session";
import { useQuery } from "../api/hooks";
import { t } from "../copy";
import { Button, Spinner } from "../design/components";
import { Header } from "./Header";
import { NavContext } from "./NavContext";
import { Sidebar } from "./Sidebar";
import { activeDeptId, currentTitle, type NavResponse } from "./nav";
import { loadPrefs, savePrefs } from "./prefs";
import "./StaffShell.css";

const DESKTOP = "(min-width: 900px)";
function useDesktop(): boolean {
  const get = () => (typeof window.matchMedia === "function" ? window.matchMedia(DESKTOP).matches : true);
  const [v, setV] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const m = window.matchMedia(DESKTOP);
    const h = () => setV(m.matches);
    m.addEventListener("change", h);
    return () => m.removeEventListener("change", h);
  }, []);
  return v;
}

/** غلاف الموظفين: سايدبار + هيدر + محتوى. على الموبايل السايدبار بيبقى drawer. */
export function StaffShell({ path, children }: { path: string; children: ComponentChildren }) {
  const user = staffUser();
  useEffect(() => {
    if (!user) goStaffLogin();
  }, [user]);

  const nav = useQuery<NavResponse | undefined>((signal) => (user ? api.get<NavResponse>("/nav", { signal }) : Promise.resolve(undefined)), [user?.id]);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [drawer, setDrawer] = useState(false);
  const desktop = useDesktop();

  useEffect(() => setDrawer(false), [path]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer]);

  const update = (next: typeof prefs) => {
    setPrefs(next);
    savePrefs(next);
  };

  if (!user) return <Spinner />;

  // الطي بيخص الديسكتوب بس؛ الـdrawer على الموبايل دايمًا مفتوح بالكامل.
  const collapsed = prefs.collapsed && desktop;
  const activeId = activeDeptId(nav.data, path);
  const isOpen = (id: string) => prefs.openDept === id || (prefs.openDept === null && activeId === id);
  const onToggleDept = (id: string) => {
    if (collapsed) update({ collapsed: false, openDept: id });
    else update({ ...prefs, openDept: isOpen(id) ? "" : id });
  };
  const name = nav.data?.user?.name ?? user.fullName ?? user.username;
  const roleLabel = nav.data?.user?.roleLabel ?? "";

  return (
    <NavContext.Provider value={nav.data}>
      <div class="st-shell" data-collapsed={collapsed ? "true" : undefined} data-drawer={drawer ? "open" : undefined}>
        <div class="st-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />
        <aside class="st-side" aria-label={t("staff.nav.label")}>
          <div class="st-side__head">
            <span class="st-side__brand" aria-hidden={collapsed ? "true" : undefined}>{collapsed ? "H" : "Hyper-Tech"}</span>
          </div>
          {nav.data ? (
            <Sidebar nav={nav.data} path={path} collapsed={collapsed} openDept={prefs.openDept} onToggleDept={onToggleDept} onNavigate={() => setDrawer(false)} />
          ) : nav.error ? (
            <div class="st-side__state" role="alert">
              <p>{t("staff.nav.err")}</p>
              <Button size="sm" variant="secondary" onClick={() => void nav.refetch()}>{t("staff.nav.retry")}</Button>
            </div>
          ) : (
            <div class="st-side__state" aria-busy="true">
              <Spinner />
              <span class="sr-only">{t("staff.nav.loading")}</span>
            </div>
          )}
        </aside>
        <div class="st-main">
          <Header
            title={currentTitle(nav.data, path)}
            name={name}
            roleLabel={roleLabel}
            collapsed={collapsed}
            onOpenDrawer={() => setDrawer(true)}
            onToggleCollapse={() => update({ ...prefs, collapsed: !prefs.collapsed })}
          />
          <main id="main" class="st-content">
            {children}
          </main>
        </div>
      </div>
    </NavContext.Provider>
  );
}
