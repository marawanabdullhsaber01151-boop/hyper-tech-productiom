import { useEffect } from "preact/hooks";
import { t } from "../copy";
import { EmptyState, Spinner } from "../design/components";
import { Link, navigate, type RouteDef } from "../app/router";
import { bootstrap, useAuth } from "./session";
import { Protected } from "./screens/Shell";
import { Home } from "./screens/Home";
import { Products } from "./screens/Products";
import { Cart } from "./screens/Cart";
import { Orders } from "./screens/Orders";
import { Notifications } from "./screens/Notifications";
import { Account } from "./screens/Account";
import { Login } from "./screens/auth/Login";
import { Join } from "./screens/auth/Join";
import { Apply } from "./screens/auth/Apply";
import { Track } from "./screens/auth/Track";
import { Activate } from "./screens/auth/Activate";
import { Recover } from "./screens/auth/Recover";
import "./portal.css";
import { Team } from "./screens/Team";

/** أول ما التطبيق يفتح: بنقرأ الجلسة، وبعدها بنحوّل لـ home أو login. */
function Entry() {
  const auth = useAuth();
  useEffect(() => {
    if (auth.status === "authed") navigate("/portal/home", { replace: true });
    else if (auth.status === "anon") navigate("/portal/login", { replace: true });
  }, [auth.status]);
  return <Spinner />;
}

/** صفحات الدخول: لو في جلسة بالفعل نروح للرئيسية. */
function Public({ children }: { children: preact.ComponentChildren }) {
  const auth = useAuth();
  useEffect(() => {
    if (auth.status === "authed") navigate("/portal/home", { replace: true });
  }, [auth.status]);
  return <>{children}</>;
}


export function NotFound() {
  return (
    <div class="pt-stack pt-center pt-auth">
      <h1 class="pt-page-title">{t("p.notFound.title")}</h1>
      <Link to="/portal/home">{t("p.notFound.home")}</Link>
    </div>
  );
}

export const portalBoot = () => void bootstrap();

export const portalRoutes: RouteDef[] = [
  { path: "/portal", render: () => <Entry /> },
  { path: "/portal/login", render: () => <Public><Login /></Public> },
  { path: "/portal/join", render: () => <Join /> },
  { path: "/portal/apply", render: () => <Apply /> },
  { path: "/portal/track", render: () => <Track /> },
  { path: "/portal/activate", render: () => <Activate /> },
  { path: "/portal/recover", render: () => <Recover /> },
  { path: "/portal/home", render: () => <Protected><Home /></Protected> },
  { path: "/portal/products", render: () => <Protected><Products /></Protected> },
  { path: "/portal/cart", render: () => <Protected perm="cart.use"><Cart /></Protected> },
  { path: "/portal/orders", render: () => <Protected><Orders /></Protected> },
  { path: "/portal/orders/:ref", render: (p) => <Protected><Orders openRef={p.ref} /></Protected> },
  { path: "/portal/notifications", render: () => <Protected><Notifications /></Protected> },
  { path: "/portal/account", render: () => <Protected><Account /></Protected> },
  { path: "/portal/team", render: () => <Protected perm="team.view"><Team /></Protected> },
];
