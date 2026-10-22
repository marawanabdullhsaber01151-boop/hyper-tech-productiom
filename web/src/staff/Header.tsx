import { useEffect, useMemo, useState } from "preact/hooks";
import { api } from "../admin/api";
import { staffSession } from "../auth/staffSession";
import { navigate } from "../app/router";
import { t } from "../copy";
import { IconButton, Menu, type MenuItem } from "../design/components";
import { applyTheme, readCachedTheme, type ThemeMode } from "../design/theme-runtime";
import { ChevronLeft, ChevronRight, LogOut, Menu as MenuIcon, Monitor, Moon, Search, Sun, UserRound } from "../design/icons";
import { CommandPalette } from "./CommandPalette";
import type { CmdItem } from "./commands";
import { NotificationCenter } from "./NotificationCenter";
import type { NavResponse } from "./nav";
import { invalidateShared } from "./sharedData";

interface Props {
  title: string | null;
  nav?: NavResponse;
  name: string;
  roleLabel: string;
  collapsed: boolean;
  onOpenDrawer: () => void;
  onToggleCollapse: () => void;
}

export async function staffLogout() {
  try {
    await api.post("/auth/logout", {});
  } catch {
    /* الجلسة ممكن تكون خلصت — المهم نمسحها من عندنا */
  }
  staffSession.clear();
  invalidateShared();
  navigate("/login", { replace: true });
}

export function Header({ title, nav, name, roleLabel, collapsed, onOpenDrawer, onToggleCollapse }: Props) {
  const mode = readCachedTheme().mode ?? "system";
  const themeItem = (m: ThemeMode, label: string, icon: MenuItem["icon"]): MenuItem => ({
    label: mode === m ? `✓ ${label}` : label,
    icon,
    onSelect: () => void applyTheme({ mode: m }),
  });
  const items: MenuItem[] = [
    themeItem("light", t("staff.header.theme.light"), Sun),
    themeItem("dark", t("staff.header.theme.dark"), Moon),
    themeItem("system", t("staff.header.theme.system"), Monitor),
    { label: t("staff.header.logout"), icon: LogOut, danger: true, onSelect: () => void staffLogout() },
  ];
  const [palette, setPalette] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // e.code عشان الاختصار يشتغل حتى والكيبورد عربي
      if ((e.ctrlKey || e.metaKey) && (e.code === "KeyK" || e.key.toLowerCase() === "k")) {
        e.preventDefault();
        setPalette((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const extra = useMemo<CmdItem[]>(
    () => [
      { id: "action:home", kind: "action", title: t("staff.cmd.act.home"), keywords: t("staff.cmd.act.homeKeys"), run: () => navigate("/staff") },
      { id: "action:theme-light", kind: "action", title: t("staff.cmd.act.light"), keywords: t("staff.cmd.act.themeKeys"), run: () => void applyTheme({ mode: "light" }) },
      { id: "action:theme-dark", kind: "action", title: t("staff.cmd.act.dark"), keywords: t("staff.cmd.act.themeKeys"), run: () => void applyTheme({ mode: "dark" }) },
      { id: "action:theme-system", kind: "action", title: t("staff.cmd.act.system"), keywords: t("staff.cmd.act.themeKeys"), run: () => void applyTheme({ mode: "system" }) },
      { id: "action:logout", kind: "action", title: t("staff.cmd.act.logout"), keywords: t("staff.cmd.act.logoutKeys"), run: () => void staffLogout() },
    ],
    [],
  );
  return (
    <header class="st-header">
      <IconButton class="st-header__drawer" icon={MenuIcon} label={t("staff.nav.open")} onClick={onOpenDrawer} />
      <IconButton
        class="st-header__collapse"
        icon={collapsed ? ChevronLeft : ChevronRight}
        flip
        label={collapsed ? t("staff.nav.expand") : t("staff.nav.collapse")}
        onClick={onToggleCollapse}
      />
      <div class="st-header__title">{title}</div>
      <div class="st-header__tools">
        <IconButton icon={Search} label={t("staff.header.search")} aria-haspopup="dialog" onClick={() => setPalette(true)} />
        <NotificationCenter nav={nav} />
        <Menu
          label={t("staff.header.menu")}
          items={items}
          trigger={({ open, toggle, id }) => (
            <button type="button" class="st-user" aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={toggle}>
              <span class="st-user__avatar" aria-hidden="true">
                <UserRound size={18} strokeWidth={1.75} />
              </span>
              <span class="st-user__txt">
                <span class="st-user__name">{name}</span>
                <span class="st-user__role">{roleLabel}</span>
              </span>
            </button>
          )}
        />
      </div>
    <CommandPalette open={palette} onClose={() => setPalette(false)} nav={nav} extra={extra} />
    </header>
  );
}
