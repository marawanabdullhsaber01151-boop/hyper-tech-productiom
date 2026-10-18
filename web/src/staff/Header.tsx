import { api } from "../admin/api";
import { staffSession } from "../auth/staffSession";
import { navigate } from "../app/router";
import { t } from "../copy";
import { IconButton, Menu, type MenuItem } from "../design/components";
import { applyTheme, readCachedTheme, type ThemeMode } from "../design/theme-runtime";
import { Bell, ChevronLeft, ChevronRight, LogOut, Menu as MenuIcon, Monitor, Moon, Search, Sun, UserRound } from "../design/icons";

interface Props {
  title: string | null;
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
  navigate("/login", { replace: true });
}

export function Header({ title, name, roleLabel, collapsed, onOpenDrawer, onToggleCollapse }: Props) {
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
        <IconButton icon={Search} label={t("staff.header.searchSoon")} disabled />
        <IconButton icon={Bell} label={t("staff.header.bell")} disabled />
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
    </header>
  );
}
