import { bestScore } from "./arabicSearch";
import type { InvItem, WorkflowOrder } from "./dashboardCore";
import type { NavResponse } from "./nav";

/** عناصر لوحة الأوامر (Ctrl+K). الدوال خالصة، وتنفيذ العنصر (run) بيجي من برّه عشان نختبر من غير متصفح. */
export type CmdKind = "page" | "action" | "sale" | "customer" | "order" | "item";
export interface CmdItem {
  id: string;
  kind: CmdKind;
  title: string;
  hint?: string;
  /** كلمات إضافية للبحث (مرادفات). */
  keywords?: string;
  run: () => void;
}

const bare = (href: string) => href.replace(/^\//, "");

/** كل صفحات القايمة المتاحة للمستخدم (مفيش صفحة بتتعرض وهو مالوش عليها صلاحية: القايمة جاية من السيرفر). */
export function pageItems(nav: NavResponse | undefined, go: (href: string) => void): CmdItem[] {
  const out: CmdItem[] = [];
  const seen = new Set<string>();
  for (const d of nav?.departments ?? [])
    for (const s of d.subFunctions)
      for (const p of s.pages) {
        if (seen.has(p.href)) continue;
        seen.add(p.href);
        out.push({ id: `page:${bare(p.href)}`, kind: "page", title: p.label, hint: `${d.label} › ${s.label}`, keywords: `${d.label} ${s.label}`, run: () => go(p.href) });
      }
  return out;
}

export const navHrefs = (nav: NavResponse | undefined): Set<string> => new Set(pageItems(nav, () => {}).map((p) => p.id.slice(5)));

/** أول صفحة من القايمة بتاعة المستخدم تنفع تعرض النوع ده من السجلات (أو null: مانعرضش نتيجة مالهاش مكان يفتحها). */
export function pickPage(hrefs: Set<string>, candidates: readonly string[]): string | null {
  for (const c of candidates) if (hrefs.has(bare(c))) return c;
  return null;
}

export const ORDER_PAGES = ["/v2/staff/production?tab=orders", "factory-supervisor.html", "factory-warehouse-manager.html", "factory-quality-controller.html", "production-control.html", "/v2/staff/production?tab=quality", "/v2/staff/operations"] as const;
export const ITEM_PAGES = ["/v2/staff/stock", "factory-warehouse-manager.html"] as const;

export function recordItems(
  orders: WorkflowOrder[],
  items: InvItem[],
  hrefs: Set<string>,
  go: (href: string) => void,
  label: { status: (s: string) => string; unit: (i: InvItem) => string },
): CmdItem[] {
  const out: CmdItem[] = [];
  const orderPage = pickPage(hrefs, ORDER_PAGES);
  if (orderPage)
    for (const o of orders) out.push({ id: `order:${o.id}`, kind: "order", title: `${o.orderNumber} — ${o.productName}`, hint: label.status(o.workflowStatus), run: () => go(orderPage) });
  const itemPage = pickPage(hrefs, ITEM_PAGES);
  if (itemPage)
    for (const i of items) {
      // صفحة المخزون الجديدة بتفتح على البحث باسم الصنف؛ الصفحات القديمة بتفتح عادي
      const target = itemPage.startsWith("/v2/") ? `${itemPage}?q=${encodeURIComponent(i.name)}` : itemPage;
      out.push({ id: `item:${i.id}`, kind: "item", title: i.name, hint: label.unit(i), run: () => go(target) });
    }
  return out;
}

export interface SaleRow {
  id: number;
  orderNumber: string;
  contactId: number | null;
  status: string;
  total: string;
}
export interface CustomerRow {
  id: number;
  name: string;
  type?: string;
  company?: string | null;
  phone?: string | null;
}

/** صفحة المبيعات الجديدة (بتظهر في القايمة بروابط فيها ?channel=). */
export const SALES_PAGE = "v2/staff/sales";
export const hasSalesPage = (hrefs: Set<string>): boolean => [...hrefs].some((h) => h === SALES_PAGE || h.startsWith(`${SALES_PAGE}?`));

/**
 * فواتير وعملاء للبحث السريع. بتتعرض بس لو صفحة المبيعات في قايمة المستخدم (هي اللي بتفتحها):
 * الفاتورة بتفتح تفاصيلها، والعميل بيفتح فواتيره.
 */
export function salesItems(
  sales: SaleRow[],
  customers: CustomerRow[],
  hrefs: Set<string>,
  go: (href: string) => void,
  label: { status: (s: string) => string; money: (v: string) => string },
): CmdItem[] {
  if (!hasSalesPage(hrefs)) return [];
  const name = new Map(customers.map((c) => [c.id, c.name]));
  const out: CmdItem[] = [];
  for (const s of sales) {
    const who = s.contactId === null ? "" : name.get(s.contactId) ?? "";
    out.push({
      id: `sale:${s.id}`,
      kind: "sale",
      title: who ? `${s.orderNumber} — ${who}` : s.orderNumber,
      hint: `${label.status(s.status)} · ${label.money(s.total)}`,
      keywords: who,
      run: () => go(`/v2/staff/sales?open=${s.id}`),
    });
  }
  for (const c of customers) {
    if (c.type && c.type !== "customer" && c.type !== "both") continue;
    out.push({
      id: `customer:${c.id}`,
      kind: "customer",
      title: c.name,
      hint: [c.company, c.phone].filter(Boolean).join(" · ") || undefined,
      keywords: `${c.company ?? ""} ${c.phone ?? ""}`,
      run: () => go(`/v2/staff/sales?customer=${c.id}`),
    });
  }
  return out;
}

export const MAX_RESULTS = 12;

/** ترتيب النتائج: الدرجة أولًا، وبعدها الأحدث استخدامًا (recent)، وبعدها النوع (صفحة قبل سجل). */
export function search(all: CmdItem[], query: string, recent: string[]): CmdItem[] {
  const kindOrder: Record<CmdKind, number> = { page: 0, action: 1, sale: 2, customer: 3, order: 4, item: 5 };
  const rec = (id: string) => {
    const i = recent.indexOf(id);
    return i === -1 ? 0 : 10 - Math.min(i, 9);
  };
  return all
    .map((c) => ({ c, s: bestScore(query, [{ text: c.title }, { text: c.keywords ?? "", weight: 0.7 }, { text: c.hint ?? "", weight: 0.5 }]) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s + rec(b.c.id) - (a.s + rec(a.c.id)) || kindOrder[a.c.kind] - kindOrder[b.c.kind])
    .slice(0, MAX_RESULTS)
    .map((x) => x.c);
}

/** الشاشة قبل ما يكتب: الأخيرة أولًا، وبعدها أول صفحات القايمة والأوامر. */
export function emptyState(all: CmdItem[], recent: string[]): CmdItem[] {
  const byId = new Map(all.map((c) => [c.id, c]));
  const recents = recent.map((id) => byId.get(id)).filter((c): c is CmdItem => !!c);
  const rest = all.filter((c) => (c.kind === "page" || c.kind === "action") && !recent.includes(c.id));
  return [...recents, ...rest].slice(0, MAX_RESULTS);
}

/* ---- الأخيرة (محليًا في المتصفح، لكل مستخدم) ---- */
const RECENT_KEY = "hyper_cmdk_recent_v1";
export function readRecent(userId: number): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(`${RECENT_KEY}:${userId}`) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}
export function pushRecent(userId: number, id: string): string[] {
  const next = [id, ...readRecent(userId).filter((x) => x !== id)].slice(0, 8);
  try {
    localStorage.setItem(`${RECENT_KEY}:${userId}`, JSON.stringify(next));
  } catch {
    /* الكتابة ممكن تتمنع (وضع خاص): مش مهم */
  }
  return next;
}

/** إشعار ← الصفحة اللي يفتحها (null: مفيش مكان معروف، فبنعلّمه مقروء من غير تنقّل). */
export function notificationTarget(n: { referenceType?: string | null; referenceId?: number | null }, nav: NavResponse | undefined): string | null {
  if (n.referenceType === "chat_conversation" || n.referenceType === "chat") return n.referenceId ? `/v2/admin/portal-chat/${n.referenceId}` : "/v2/admin/portal-chat";
  if (n.referenceType === "system_health") return "/v2/staff/system-health";
  if (n.referenceType === "operations_center") return "/v2/staff/operations";
  if (n.referenceType === "operations_plan") return "/v2/staff/operations?tab=plans";
  if (n.referenceType === "purchase_requisition") return "/v2/staff/purchases";
  if (n.referenceType === "production_request") return "/v2/staff/production?tab=requests";
  if (n.referenceType === "operations_case") return n.referenceId ? `/v2/staff/operations?case=${n.referenceId}` : "/v2/staff/operations";
  if (n.referenceType === "production_workflow") return pickPage(navHrefs(nav), ORDER_PAGES) ?? nav?.homeHref ?? null;
  return null;
}
