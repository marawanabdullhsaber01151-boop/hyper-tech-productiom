/** @format */
/**
 * التقارير القابلة للتصدير (الخطوة 41أ): تعريفات وحسابات نقية. كل المبالغ بالقروش (BigInt) وبتتحوّل لنص «0.00» في الآخر،
 * فمفيش جمع أرقام عشرية عائمة. الاستعلام نفسه في src/routes/reports.ts.
 */
import { centsToString, lineTotalCents, toCents } from "../lib/money";

export type ReportId = "sales" | "inventory" | "purchases";
export type ColumnKind = "text" | "int" | "qty" | "money";
export interface ReportColumn { key: string; label: string; kind: ColumnKind }
export type Cell = string | number | null;
export interface ReportResult {
  id: ReportId; title: string; columns: ReportColumn[]; rows: Cell[][];
  /** صف الإجماليات بنفس ترتيب الأعمدة (null = مفيش إجمالي للعمود). */
  totals: Cell[]; truncated: boolean;
}

/** أدوار كل تقرير: نفس من بيشوفوا الأسعار في fieldMasking (الإدارة العليا + أصحاب القسم). */
export const REPORT_ROLES: Readonly<Record<ReportId, readonly string[]>> = {
  sales: ["chairman", "executive_manager", "sales_manager"],
  inventory: ["chairman", "executive_manager", "warehouse_manager"],
  purchases: ["chairman", "executive_manager", "purchasing_manager"],
};
export const REPORT_IDS = Object.keys(REPORT_ROLES) as ReportId[];
export const isReportId = (v: unknown): v is ReportId => typeof v === "string" && (REPORT_IDS as string[]).includes(v);
export const reportsFor = (role: string): ReportId[] => REPORT_IDS.filter((id) => REPORT_ROLES[id].includes(role));
/** التقرير بيحتاج فترة (من/إلى)؟ المخزون لقطة اللحظة فمفيش فترة. */
export const needsRange = (id: ReportId) => id !== "inventory";
export const ROW_LIMIT = 5000;

export const REPORT_TITLES: Readonly<Record<ReportId, string>> = {
  sales: "تقرير المبيعات",
  inventory: "تقرير المخزون",
  purchases: "تقرير المشتريات",
};

const COLUMNS: Readonly<Record<ReportId, ReportColumn[]>> = {
  sales: [
    { key: "orderNumber", label: "رقم الفاتورة", kind: "text" },
    { key: "date", label: "التاريخ", kind: "text" },
    { key: "customer", label: "العميل", kind: "text" },
    { key: "channel", label: "القناة", kind: "text" },
    { key: "status", label: "الحالة", kind: "text" },
    { key: "subtotal", label: "قبل الخصم", kind: "money" },
    { key: "total", label: "الإجمالي", kind: "money" },
  ],
  inventory: [
    { key: "code", label: "الكود", kind: "text" },
    { key: "name", label: "الصنف", kind: "text" },
    { key: "category", label: "الفئة", kind: "text" },
    { key: "unit", label: "الوحدة", kind: "text" },
    { key: "qty", label: "الكمية", kind: "qty" },
    { key: "reserved", label: "المحجوز", kind: "qty" },
    { key: "min", label: "الحد الأدنى", kind: "qty" },
    { key: "unitPrice", label: "سعر الوحدة", kind: "money" },
    { key: "value", label: "القيمة", kind: "money" },
    { key: "state", label: "الحالة", kind: "text" },
  ],
  purchases: [
    { key: "poNumber", label: "رقم الأمر", kind: "text" },
    { key: "date", label: "التاريخ", kind: "text" },
    { key: "supplier", label: "المورد", kind: "text" },
    { key: "status", label: "الحالة", kind: "text" },
    { key: "ordered", label: "الكمية المطلوبة", kind: "qty" },
    { key: "received", label: "الكمية المستلمة", kind: "qty" },
    { key: "receivedPct", label: "نسبة الاستلام %", kind: "int" },
    { key: "total", label: "الإجمالي", kind: "money" },
  ],
};
export const columnsOf = (id: ReportId): ReportColumn[] => COLUMNS[id];

export const CHANNEL_LABEL: Readonly<Record<string, string>> = { direct: "مباشر", website: "الموقع" };
export const SALES_STATUS_LABEL: Readonly<Record<string, string>> = { draft: "مسودة", pending_approval: "في انتظار الاعتماد", confirmed: "مؤكدة", shipped: "تم الشحن", paid: "مدفوعة", cancelled: "ملغاة" };
export const PO_STATUS_LABEL: Readonly<Record<string, string>> = { draft: "مسودة", pending_approval: "في انتظار الاعتماد", approved: "معتمد", sent: "مُرسل", partially_received: "استلام جزئي", received: "تم الاستلام", cancelled: "ملغي" };
export const CATEGORY_LABEL: Readonly<Record<string, string>> = { raw_material: "مواد خام", wip: "تحت التصنيع", finished_good: "منتج تام" };
const label = (map: Readonly<Record<string, string>>, v: string) => map[v] ?? v;

/** عنوان صف الإجماليات مع عدد الصفوف. */
export const totalLabel = (n: number) => `الإجمالي (${n})`;
const money = (cents: bigint) => centsToString(cents);
/** رقم نصي سليم أو صفر (القيم الفاسدة ما بتكسرش التقرير). */
const cents = (v: string | number | null | undefined): bigint => { try { return v === null || v === undefined || v === "" ? 0n : toCents(v); } catch { return 0n; } };
const num = (v: string | number | null | undefined): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
/** كميات بثلاث خانات بحد أقصى من غير جمع عائم: بنجمع بالألف (عدد صحيح). */
const milli = (v: string | number | null | undefined): bigint => { const n = Math.round(num(v) * 1000); return BigInt(n); };
const milliNum = (m: bigint) => Number(m) / 1000;

export interface SalesRaw { orderNumber: string; date: string; customer: string | null; channel: string; status: string; subtotal: string | null; total: string }
export function salesReport(raw: readonly SalesRaw[], truncated = false): ReportResult {
  let sub = 0n; let tot = 0n;
  const rows: Cell[][] = raw.map((r) => {
    sub += cents(r.subtotal); tot += cents(r.total);
    return [r.orderNumber, r.date, r.customer ?? "—", label(CHANNEL_LABEL, r.channel), label(SALES_STATUS_LABEL, r.status), money(cents(r.subtotal)), money(cents(r.total))];
  });
  return { id: "sales", title: REPORT_TITLES.sales, columns: columnsOf("sales"), rows, totals: [totalLabel(rows.length), null, null, null, null, money(sub), money(tot)], truncated };
}

export interface InventoryRaw { code: string | null; name: string; category: string; unit: string | null; qty: string; reservedQty: string | null; minQty: string | null; unitPrice: string | null }
export type StockStateId = "out" | "low" | "ok";
export const STOCK_STATE_LABEL: Readonly<Record<StockStateId, string>> = { out: "نافد", low: "تحت الحد الأدنى", ok: "كافي" };
/** نافد = صفر أو أقل. تحت الحد = أقل من أو يساوي الحد الأدنى (لو الحد > 0). */
export function stockStateOf(qty: string | number, min: string | number | null): StockStateId {
  const q = num(qty); const m = num(min);
  if (q <= 0) return "out";
  return m > 0 && q <= m ? "low" : "ok";
}
export function inventoryReport(raw: readonly InventoryRaw[], truncated = false): ReportResult {
  let value = 0n; let qtyM = 0n; let low = 0;
  const rows: Cell[][] = raw.map((r) => {
    const v = lineTotalCentsSafe(r.qty, r.unitPrice);
    value += v; qtyM += milli(r.qty);
    const st = stockStateOf(r.qty, r.minQty);
    if (st !== "ok") low += 1;
    return [r.code ?? "—", r.name, label(CATEGORY_LABEL, r.category), r.unit ?? "—", num(r.qty), num(r.reservedQty), r.minQty === null ? null : num(r.minQty), money(cents(r.unitPrice)), money(v), STOCK_STATE_LABEL[st]];
  });
  return { id: "inventory", title: REPORT_TITLES.inventory, columns: columnsOf("inventory"), rows, totals: [totalLabel(rows.length), null, null, null, milliNum(qtyM), null, null, null, money(value), low ? `${low} يحتاج متابعة` : null], truncated };
}
/** الكمية × السعر بالقروش؛ الكمية السالبة أو الفاسدة = صفر (القيمة ما تبقاش سالبة). */
function lineTotalCentsSafe(qty: string | number, price: string | number | null): bigint {
  if (num(qty) <= 0) return 0n;
  try { return lineTotalCents(qty, price ?? 0); } catch { return 0n; }
}

export interface PurchasesRaw { poNumber: string; date: string; supplier: string | null; status: string; orderedQty: string | null; receivedQty: string | null; total: string }
export function purchasesReport(raw: readonly PurchasesRaw[], truncated = false): ReportResult {
  let tot = 0n; let ord = 0n; let rec = 0n;
  const rows: Cell[][] = raw.map((r) => {
    const o = milli(r.orderedQty); const c = milli(r.receivedQty);
    tot += cents(r.total); ord += o; rec += c;
    return [r.poNumber, r.date, r.supplier ?? "—", label(PO_STATUS_LABEL, r.status), milliNum(o), milliNum(c), pct(c, o), money(cents(r.total))];
  });
  return { id: "purchases", title: REPORT_TITLES.purchases, columns: columnsOf("purchases"), rows, totals: [totalLabel(rows.length), null, null, null, milliNum(ord), milliNum(rec), pct(rec, ord), money(tot)], truncated };
}
/** نسبة الاستلام: صحيح مقرّب، ومحدود بـ100 (استلام زيادة ما يطلعش 130%). صفر مطلوب = 0. */
export function pct(received: bigint, ordered: bigint): number {
  if (ordered <= 0n) return 0;
  return Math.min(100, Math.round((Number(received) / Number(ordered)) * 100));
}

/** اسم ملف التصدير: ASCII بس، فيه التاريخ. */
export function exportFileName(id: ReportId, from: string | null, to: string | null, ext: "xlsx" | "csv"): string {
  const span = from && to ? `_${from}_${to}` : "";
  return `report-${id}${span}.${ext}`;
}

/** الصف → CSV (القيم الأرقام بتتكتب كأرقام، والنص بيتهرّب من الأول بـcsvCell في الراوت). */
export function csvRows(r: ReportResult): Cell[][] {
  return [r.columns.map((c) => c.label), ...r.rows, r.totals];
}
