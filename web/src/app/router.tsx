import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

/** راوتر خفيف على /v2/*: path بس، بدون مكتبات. */
const BASE = "/v2";
const strip = (p: string) => (p.startsWith(BASE) ? p.slice(BASE.length) || "/" : p);

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const url = BASE + (to.startsWith("/") ? to : `/${to}`);
  if (opts.replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function usePath(): string {
  const [p, setP] = useState(() => strip(location.pathname));
  useEffect(() => {
    const h = () => setP(strip(location.pathname));
    window.addEventListener("popstate", h);
    return () => window.removeEventListener("popstate", h);
  }, []);
  return p;
}

export interface RouteDef {
  /** "/team" أو "/orders/:id" */
  path: string;
  render: (params: Record<string, string>) => ComponentChildren;
}

export function matchRoute(routes: RouteDef[], path: string): { route: RouteDef; params: Record<string, string> } | null {
  const segs = path.split("/").filter(Boolean);
  for (const route of routes) {
    const rs = route.path.split("/").filter(Boolean);
    if (rs.length !== segs.length) continue;
    const params: Record<string, string> = {};
    const ok = rs.every((r, i) => {
      if (r.startsWith(":")) {
        params[r.slice(1)] = decodeURIComponent(segs[i]!);
        return true;
      }
      return r === segs[i];
    });
    if (ok) return { route, params };
  }
  return null;
}

export function Router({ routes, notFound }: { routes: RouteDef[]; notFound: () => ComponentChildren }) {
  const path = usePath();
  const m = matchRoute(routes, path);
  return <>{m ? m.route.render(m.params) : notFound()}</>;
}

/** رابط بيشتغل بدون reload. */
export function Link({ to, children, class: cls, ...rest }: { to: string; children: ComponentChildren; class?: string; "aria-current"?: "page" | undefined; "aria-label"?: string }) {
  return (
    <a
      {...rest}
      class={cls}
      href={BASE + to}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
