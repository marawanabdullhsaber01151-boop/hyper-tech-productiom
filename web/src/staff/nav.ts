import { Circle, Database, Factory, Globe, Landmark, ShieldCheck, ShoppingCart, Warehouse, Workflow } from "../design/icons";

/** شكل رد GET /api/v1/nav (قسم ← محور ← صفحة). */
export interface NavPageDto {
  id: string;
  label: string;
  href: string;
  badgeCount?: number;
}
export interface NavSubDto {
  id: string;
  label: string;
  pages: NavPageDto[];
}
export interface NavDeptDto {
  id: string;
  label: string;
  icon: string;
  subFunctions: NavSubDto[];
}
export interface NavResponse {
  role: string;
  user?: { name: string; role: string; roleLabel: string };
  departments: NavDeptDto[];
  singleDepartment: boolean;
  homeHref: string | null;
}

export type NavIcon = typeof Circle;

/** أيقونات الأقسام: أسماء Font Awesome اللي السيرفر بيبعتها ← Lucide. غير المعروف ← دايرة. */
const ICONS: Record<string, NavIcon> = {
  "cart-shopping": ShoppingCart,
  database: Database,
  "diagram-project": Workflow,
  globe: Globe,
  industry: Factory,
  landmark: Landmark,
  "shield-halved": ShieldCheck,
  warehouse: Warehouse,
};

export function iconFor(name: string | undefined | null): NavIcon {
  const key = (name ?? "")
    .trim()
    .replace(/^fa-(?:solid|regular|brands)\s+/, "")
    .replace(/^fa-/, "");
  return ICONS[key] ?? Circle;
}

export type ResolvedHref = { kind: "spa"; to: string } | { kind: "legacy"; href: string };

/** روابط /v2/... بتنقل جوّه التطبيق، وأي حاجة تانية (صفحات .html القديمة) بتفتح بتحميل كامل. */
export function resolveHref(href: string): ResolvedHref {
  if (href === "/v2" || href.startsWith("/v2/")) return { kind: "spa", to: href.slice(3) || "/" };
  if (/^[a-z]+:\/\//i.test(href)) return { kind: "legacy", href };
  return { kind: "legacy", href: href.startsWith("/") ? href : `/${href}` };
}

export function isActiveHref(path: string, href: string): boolean {
  const r = resolveHref(href);
  if (r.kind !== "spa") return false;
  return path === r.to || path.startsWith(`${r.to}/`);
}

export function deptPageCount(d: NavDeptDto): number {
  return d.subFunctions.reduce((n, s) => n + s.pages.length, 0);
}

/** عنوان الصفحة الحالية للهيدر (لو هي في القايمة). */
export function currentTitle(nav: NavResponse | undefined, path: string): string | null {
  if (!nav) return null;
  for (const d of nav.departments) {
    for (const s of d.subFunctions) {
      for (const p of s.pages) if (isActiveHref(path, p.href)) return p.label;
    }
  }
  return null;
}

/** القسم اللي فيه الصفحة الحالية (عشان يتفتح تلقائي). */
export function activeDeptId(nav: NavResponse | undefined, path: string): string | null {
  if (!nav) return null;
  for (const d of nav.departments) {
    if (d.subFunctions.some((s) => s.pages.some((p) => isActiveHref(path, p.href)))) return d.id;
  }
  return null;
}

/** مسار تحويل بعد الدخول: next لازم يكون جوّه الموقع (بيمنع open-redirect). */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  return raw;
}
