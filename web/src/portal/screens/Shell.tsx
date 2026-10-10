import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { t } from "../../copy";
import { Banner, Icon, IconButton, Spinner } from "../../design/components";
import { Bell, ClipboardList, House, Package, ShoppingCart, UserRound, WifiOff, Users } from "../../design/icons";
import { ErrorBoundary } from "../../app/ErrorBoundary";
import { Link, navigate, usePath } from "../../app/router";
import { cartStore, loadCart, useCart } from "../cart";
import { useUnread, useUnreadPolling } from "../notifications";
import { can, useAuth } from "../session";

function useOnline(): boolean {
  const [on, setOn] = useState(() => navigator.onLine);
  useEffect(() => {
    const u = () => setOn(true);
    const d = () => setOn(false);
    window.addEventListener("online", u);
    window.addEventListener("offline", d);
    return () => {
      window.removeEventListener("online", u);
      window.removeEventListener("offline", d);
    };
  }, []);
  return on;
}

/** بيحمي الصفحات: لو مفيش جلسة بيودّي للدخول. */
export function Protected({ children, perm }: { children: ComponentChildren; perm?: string }) {
  const auth = useAuth();
  useEffect(() => {
    if (auth.status === "anon") navigate("/portal/login", { replace: true });
  }, [auth.status]);
  if (auth.status !== "authed") return <Spinner />;
  return <Shell perm={perm}>{children}</Shell>;
}

function Forbidden() {
  return (
    <div class="pt-stack pt-center" role="alert">
      <h1 class="pt-page-title">{t("p.forbidden.title")}</h1>
      <p class="pt-muted">{t("p.forbidden.body")}</p>
      <Link to="/portal/home">{t("p.notFound.home")}</Link>
    </div>
  );
}

function Shell({ children, perm }: { children: ComponentChildren; perm?: string }) {
  const auth = useAuth();
  const path = usePath();
  const online = useOnline();
  const unread = useUnread();
  const cart = useCart();
  useUnreadPolling(true);
  useEffect(() => {
    if (!cartStore.get().loaded) void loadCart().catch(() => undefined);
  }, []);

  const showCart = can("cart.use");
  const links: Array<{ to: string; label: string; icon: typeof House; badge?: number; show: boolean }> = [
    { to: "/portal/home", label: t("p.nav.home"), icon: House, show: true },
    { to: "/portal/products", label: t("p.nav.products"), icon: Package, show: true },
    { to: "/portal/cart", label: t("p.nav.cart"), icon: ShoppingCart, badge: cart.items.length, show: showCart },
    { to: "/portal/orders", label: can("orders.view_company") ? t("p.nav.companyOrders") : t("p.nav.orders"), icon: ClipboardList, show: can("orders.view_own") || can("orders.view_company") },
    { to: "/portal/team", label: t("p.nav.team"), icon: Users, show: can("team.view") },
    { to: "/portal/account", label: t("p.nav.account"), icon: UserRound, show: true },
  ];

  return (
    <div class="pt-shell">
      <header class="pt-header">
        <Link to="/portal/home" class="pt-header__brand">
          <span class="pt-brand__mark" aria-hidden="true">
            HT
          </span>
          <span>{t("p.brand")}</span>
        </Link>
        <span class="pt-header__company">{auth.customer?.companyName}</span>
        <span class="pt-header__spacer" />
        <span class="pt-badge-wrap">
          <IconButton icon={Bell} label={t("p.nav.notifications")} onClick={() => navigate("/portal/notifications")} />
          {unread > 0 ? (
            <span class="pt-badge" aria-hidden="true">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </span>
      </header>
      <div class="pt-body">
        <nav class="pt-nav" aria-label={t("p.nav.main")}>
          {links
            .filter((l) => l.show)
            .map((l) => (
              <Link key={l.to} to={l.to} class="pt-nav__link" aria-current={path === l.to || (l.to !== "/portal/home" && path.startsWith(l.to)) ? "page" : undefined}>
                <span class="pt-badge-wrap">
                  <Icon icon={l.icon} size={20} />
                  {l.badge ? (
                    <span class="pt-badge" aria-hidden="true">
                      {l.badge}
                    </span>
                  ) : null}
                </span>
                <span>{l.label}</span>
              </Link>
            ))}
        </nav>
        <main class="pt-main" id="main">
          {!online ? (
            <Banner tone="warn">
              <Icon icon={WifiOff} size={16} /> {t("p.offline")}
            </Banner>
          ) : null}
          <ErrorBoundary resetKey={path}>{perm && !can(perm) ? <Forbidden /> : children}</ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
