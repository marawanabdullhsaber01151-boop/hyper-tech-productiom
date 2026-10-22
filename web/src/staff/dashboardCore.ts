import { stockState } from "./Stock";

/** حاجات خالصة (من غير واجهة) للوحة الرئيسية: المؤشرات والتنبيهات والتوزيعات. متغطّية باختبارات. */

export interface WorkflowOrder {
  id: number;
  orderNumber: string;
  productName: string;
  qty: string | number | null;
  workflowStatus: string;
  neededBy?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  unit?: string | null;
  supervisorId?: number | null;
  qualityControllerUserId?: number | null;
}
export interface InvItem {
  id: number;
  name: string;
  unit?: string | null;
  qty: string | number;
  minQty: string | number;
  category: string;
}
export interface DashSummary {
  quality?: { passRate?: number; trend?: { direction?: string } };
  sales?: { trend?: { last7DaysOrders?: number } };
  inventory?: { approachingLowStock?: Array<{ id: number; name: string; proximityRatio?: number | null }> };
}

export const DELIVERED = ["delivered_customer", "delivered_warehouse"] as const;
export const isDelivered = (o: Pick<WorkflowOrder, "workflowStatus">) => (DELIVERED as readonly string[]).includes(o.workflowStatus);
export const isActive = (o: Pick<WorkflowOrder, "workflowStatus">) => !isDelivered(o) && o.workflowStatus !== "cancelled";

/** الحالات المعروفة (بتتحوّل لنص من copy). أي حالة جديدة من السيرفر بتتعرض باسمها الخام بدل ما تتسمّى «جديد» غلط. */
export const KNOWN_STATUSES = [
  "new",
  "pending_supervisor",
  "materials_requested",
  "materials_approved",
  "materials_partial",
  "materials_rejected",
  "in_production",
  "quality_check",
  "delivery_pending_customer",
  "delivery_pending_warehouse",
  "completed",
  "delivered_customer",
  "delivered_warehouse",
  "cancelled",
] as const;
export type KnownStatus = (typeof KNOWN_STATUSES)[number];
export const isKnownStatus = (s: string): s is KnownStatus => (KNOWN_STATUSES as readonly string[]).includes(s);

export type StatusTone = "neutral" | "info" | "success" | "warn" | "danger" | "brand";
export function statusTone(s: string): StatusTone {
  switch (s) {
    case "materials_rejected":
    case "cancelled":
      return "danger";
    case "pending_supervisor":
    case "materials_requested":
    case "materials_partial":
    case "delivery_pending_customer":
    case "delivery_pending_warehouse":
      return "warn";
    case "in_production":
    case "delivered_customer":
    case "delivered_warehouse":
      return "success";
    case "materials_approved":
    case "new":
      return "info";
    case "quality_check":
    case "completed":
      return "brand";
    default:
      return "neutral";
  }
}

/** التوزيع اللي بيظهر كأعمدة: نفس المجموعات اللي كانت في اللوحة القديمة. */
export const STATUS_GROUPS = ["materials_requested", "in_production", "quality_check", "completed", "materials_rejected"] as const;
export function statusCounts(orders: WorkflowOrder[]): Array<{ status: (typeof STATUS_GROUPS)[number]; count: number }> {
  return STATUS_GROUPS.map((status) => ({ status, count: orders.filter((o) => o.workflowStatus === status).length }));
}

export interface Kpis {
  completedThisMonth: number;
  active: number;
  lowStock: number;
  /** متوسط تغطية الكمية للحد الأدنى (الصنف من غير حد أدنى بيتحسب ١٠٠٪). */
  coverage: number;
}
/** now بتتبعت عشان الاختبار ثابت. الشهر بتوقيت UTC زي السيرفر (ISO). */
export function computeKpis(orders: WorkflowOrder[], items: InvItem[], now: Date = new Date()): Kpis {
  const month = now.toISOString().slice(0, 7);
  const completedThisMonth = orders.filter((o) => isDelivered(o) && (o.updatedAt || o.createdAt || "").slice(0, 7) === month).length;
  const lowStock = items.filter((i) => stockState({ qty: String(i.qty), minQty: String(i.minQty) }) !== "ok").length;
  let coverage = 0;
  if (items.length) {
    const ratios = items.map((i) => {
      const min = Number(i.minQty);
      return min > 0 ? Math.min(100, Math.round((Number(i.qty) / min) * 100)) : 100;
    });
    coverage = Math.round(ratios.reduce((a, b) => a + b, 0) / ratios.length);
  }
  return { completedThisMonth, active: orders.filter(isActive).length, lowStock, coverage };
}

export interface CategoryShare {
  category: "raw_material" | "wip" | "finished_good";
  count: number;
  pct: number;
}
export function categoryShares(items: InvItem[]): CategoryShare[] {
  const cats = ["raw_material", "wip", "finished_good"] as const;
  const total = items.length || 1;
  return cats.map((category) => {
    const count = items.filter((i) => i.category === category).length;
    return { category, count, pct: Math.round((count / total) * 100) };
  });
}

export type AlertKind = "out" | "low" | "rejected" | "late" | "waiting" | "near";
export interface DashAlert {
  id: string;
  kind: AlertKind;
  tone: "danger" | "warn" | "info";
  /** اسم الصنف أو رقم الأمر. */
  subject: string;
  /** اسم المنتج (للأوامر) أو الوحدة (للأصناف). */
  detail: string;
  qty?: number;
  min?: number;
  due?: string;
}
const ORDER: Record<DashAlert["tone"], number> = { danger: 0, warn: 1, info: 2 };

/**
 * التنبيهات المشتقة. «منخفض» بنفس تعريف صفحة المخزون (الكمية ≤ الحد الأدنى) عشان الرقمين ما يختلفوش بين الصفحتين
 * (اللوحة القديمة كانت بتستخدم عتبة ٤٠٪ فكانت بتقول رقم غير صفحة المخزون).
 * today = YYYY-MM-DD.
 */
export function deriveAlerts(orders: WorkflowOrder[], items: InvItem[], summary: DashSummary | null, today: string): DashAlert[] {
  const out: DashAlert[] = [];
  const covered = new Set<number>();
  for (const i of items) {
    const s = stockState({ qty: String(i.qty), minQty: String(i.minQty) });
    if (s === "ok") continue;
    covered.add(i.id);
    out.push({ id: `inv-${i.id}`, kind: s === "out" ? "out" : "low", tone: s === "out" ? "danger" : "warn", subject: i.name, detail: i.unit ?? "", qty: Number(i.qty) || 0, min: Number(i.minQty) || 0 });
  }
  for (const o of orders) {
    if (o.workflowStatus === "materials_rejected") out.push({ id: `po-${o.id}`, kind: "rejected", tone: "danger", subject: o.orderNumber, detail: o.productName });
    else if (isActive(o) && o.neededBy && o.neededBy.slice(0, 10) < today) out.push({ id: `po-${o.id}`, kind: "late", tone: "danger", subject: o.orderNumber, detail: o.productName, due: o.neededBy });
    else if (o.workflowStatus === "materials_requested") out.push({ id: `po-${o.id}`, kind: "waiting", tone: "warn", subject: o.orderNumber, detail: o.productName });
  }
  for (const n of summary?.inventory?.approachingLowStock ?? []) {
    if (!covered.has(n.id)) out.push({ id: `near-${n.id}`, kind: "near", tone: "info", subject: n.name, detail: "" });
  }
  return out.sort((a, b) => ORDER[a.tone] - ORDER[b.tone]);
}
