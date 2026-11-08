/** منطق نقي لصفحة التقارير (الخطوة 41أ). الحسابات نفسها بتتم في السيرفر؛ هنا الفترة وتنسيق العرض ومسار التصدير بس. */
import { presetRange } from "./oeeCore";

export type ReportId = "sales" | "inventory" | "purchases";
export type ColumnKind = "text" | "int" | "qty" | "money";
export interface ReportColumn { key: string; label: string; kind: ColumnKind }
export type Cell = string | number | null;
export interface ReportResult { id: ReportId; title: string; columns: ReportColumn[]; rows: Cell[][]; totals: Cell[]; truncated: boolean }
export interface ReportMeta { id: ReportId; title: string; needsRange: boolean }
export type ExportFormat = "xlsx" | "csv";

/** كل من ممكن يشوف تقرير (السيرفر بيحدد المتاح لكل دور). */
export const REPORT_PAGE_ROLES = ["chairman", "executive_manager", "sales_manager", "warehouse_manager", "purchasing_manager"] as const;
export const MAX_RANGE_DAYS = 366;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dayNo = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
export type RangeProblem = "format" | "order" | "long";
/** من/إلى: تاريخين صحيحين، من ≤ إلى، وبحد أقصى سنة (نفس حد السيرفر). */
export function rangeProblem(from: string, to: string): RangeProblem | null {
  if (!ISO.test(from) || !ISO.test(to) || Number.isNaN(dayNo(from)) || Number.isNaN(dayNo(to))) return "format";
  if (to < from) return "order";
  return dayNo(to) - dayNo(from) > MAX_RANGE_DAYS - 1 ? "long" : null;
}
export const defaultRange = (now = new Date()) => presetRange("month", now);

/** نفس الفترة تتبعت للمعاينة والتصدير؛ المخزون من غير فترة. */
export function reportQuery(meta: Pick<ReportMeta, "needsRange">, from: string, to: string, status: string, format?: ExportFormat): Record<string, string> {
  const q: Record<string, string> = {};
  if (meta.needsRange) { q.from = from; q.to = to; }
  if (status) q.status = status;
  if (format) q.format = format;
  return q;
}
export const exportFileName = (id: ReportId, meta: Pick<ReportMeta, "needsRange">, from: string, to: string, format: ExportFormat) =>
  `report-${id}${meta.needsRange ? `_${from}_${to}` : ""}.${format}`;

const num = (v: Cell): number | null => { if (v === null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const fmt = (n: number, digits: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
/** خلية للعرض: المبلغ بخانتين، الكمية حتى 3 خانات، الصحيح من غير كسور. القيم غير الرقمية بتتعرض زي ما هي. */
export function displayCell(kind: ColumnKind, v: Cell): string {
  if (v === null || v === "") return "";
  if (kind === "text") return String(v);
  const n = num(v);
  if (n === null) return String(v);
  if (kind === "money") return fmt(n, 2);
  if (kind === "int") return fmt(Math.round(n), 0);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);
}
export const isNumericKind = (k: ColumnKind) => k !== "text";

/** فلتر الحالة المتاح لكل تقرير (القيم زي ما السيرفر بيقبلها). */
export const STATUS_FILTERS: Readonly<Record<ReportId, readonly string[]>> = {
  sales: ["confirmed", "shipped", "paid", "pending_approval"],
  inventory: [],
  purchases: ["pending_approval", "approved", "sent", "partially_received", "received"],
};
