/** منطق المبيعات النقي (من غير شاشة): الحالات، الانتقالات المسموحة، الحسابات، التواريخ، CSV. بيعكس قواعد السيرفر. */

export const SALES_STATUSES = ["draft", "pending_approval", "confirmed", "shipped", "paid", "cancelled"] as const;
export type SalesStatus = (typeof SALES_STATUSES)[number];
export type SalesChannel = "website" | "direct";

export interface SalesItem {
  id?: number;
  inventoryItemId: number | null;
  description: string;
  qty: string;
  unitPrice: string;
  total: string;
}
export interface SalesOrder {
  id: number;
  orderNumber: string;
  contactId: number | null;
  channel: SalesChannel;
  date: string;
  dueDate: string | null;
  status: string;
  notes: string | null;
  subtotal: string;
  total: string;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
  items?: SalesItem[];
}

export const isSalesStatus = (v: string): v is SalesStatus => (SALES_STATUSES as readonly string[]).includes(v);

export const STATUS_TONE = {
  draft: "neutral",
  pending_approval: "warn",
  confirmed: "info",
  shipped: "brand",
  paid: "success",
  cancelled: "danger",
} as const;

/** الوضع الطبيعي للأمر: مسودة ← مؤكد ← تم الشحن ← تم الدفع. */
const LIFECYCLE: Record<string, number> = { draft: 0, confirmed: 1, shipped: 2, paid: 3 };

/** الحالات اللي ينفع تتنقل لها من حالة معيّنة (نفس قواعد salesStatusTransition في السيرفر). الاعتماد بيتم من قرار الاعتماد، مش من هنا. */
export function allowedNext(from: string): SalesStatus[] {
  const f = LIFECYCLE[from];
  if (f === undefined) return [];
  const forward = (["confirmed", "shipped", "paid"] as const).filter((s) => (LIFECYCLE[s] ?? 0) > f);
  return [...forward, "cancelled"];
}

/** الخطوة الأساسية التالية (الزرار الكبير). */
export function primaryNext(from: string): SalesStatus | null {
  return from === "draft" ? "confirmed" : from === "confirmed" ? "shipped" : from === "shipped" ? "paid" : null;
}

export type StockEffect = "reserve" | "release" | "deduct" | "restore";

/** أثر الانتقال على المخزون (معاينة قبل التنفيذ). */
export function stockEffects(from: string, to: string): StockEffect[] {
  if (from === to) return [];
  const f = LIFECYCLE[from];
  if (f === undefined) return [];
  if (to === "cancelled") return f === 1 ? ["release"] : f >= 2 ? ["restore"] : [];
  const p = LIFECYCLE[to];
  if (p === undefined || p < f) return [];
  const out: StockEffect[] = [];
  if (f < 1 && p >= 1) out.push("reserve");
  if (f < 2 && p >= 2) out.push("release", "deduct");
  return out;
}

// ── الحسابات (أعداد صحيحة: الكمية 3 منازل × السعر منزلتين، تقريب نصف لفوق زي السيرفر) ──
const DEC = /^\d+(?:\.\d+)?$/;
function scaled(v: string, scale: number): bigint | null {
  const s = v.trim();
  if (!DEC.test(s)) return null;
  const [w, f = ""] = s.split(".");
  if (f.length > scale) return null;
  return BigInt(w ?? "0") * 10n ** BigInt(scale) + BigInt((f + "0".repeat(scale)).slice(0, scale) || "0");
}
const money = (c: bigint) => `${c / 100n}.${String(c % 100n).padStart(2, "0")}`;

/** إجمالي بند = الكمية × السعر. null لو أي قيمة غير صالحة. */
export function lineTotal(qty: string, price: string): string | null {
  const q = scaled(qty, 3);
  const p = scaled(price === "" ? "0" : price, 2);
  if (q === null || p === null) return null;
  return money((q * p + 500n) / 1000n);
}
export function sumTotals(totals: Array<string | null>): string {
  let c = 0n;
  for (const t of totals) {
    const v = t === null ? null : scaled(t, 2);
    if (v !== null) c += v;
  }
  return money(c);
}
export const validQty = (qty: string) => {
  const q = scaled(qty, 3);
  return q !== null && q > 0n;
};

// ── التواريخ ──
export type DatePreset = "all" | "today" | "week" | "month" | "year";
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const todayStr = (now: Date = new Date()) => ymd(now);

export function dateBounds(p: DatePreset, now: Date = new Date()): { from?: string; to?: string } {
  if (p === "all") return {};
  const to = ymd(now);
  if (p === "today") return { from: to, to };
  if (p === "week") {
    const d = new Date(now);
    d.setDate(d.getDate() - 6);
    return { from: ymd(d), to };
  }
  if (p === "month") return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`, to };
  return { from: `${now.getFullYear()}-01-01`, to };
}

/** الفاتورة متأخرة: ليها استحقاق عدّى وهي لسه قيد التحصيل (مؤكدة أو تم شحنها). */
export function isOverdue(o: Pick<SalesOrder, "status" | "dueDate">, now: Date = new Date()): boolean {
  if (!o.dueDate) return false;
  if (o.status !== "confirmed" && o.status !== "shipped") return false;
  return o.dueDate < ymd(now);
}
export function overdueDays(o: Pick<SalesOrder, "dueDate">, now: Date = new Date()): number {
  if (!o.dueDate) return 0;
  const a = Date.parse(`${ymd(now)}T00:00:00Z`);
  const b = Date.parse(`${o.dueDate}T00:00:00Z`);
  return Math.max(0, Math.round((a - b) / 86_400_000));
}

/** رقم فاتورة مقترح (المستخدم يقدر يغيّره). مبني على الوقت عشان مفيش تكرار بين مستخدمين. */
export function suggestOrderNumber(now: Date = new Date()): string {
  const tail = String(now.getTime() % 1_000_000).padStart(6, "0");
  return `INV-${now.getFullYear()}-${tail}`;
}

// ── CSV (بيفتح في Excel بالعربي: BOM + حماية من الصيغ) ──
export function csvCell(v: string): string {
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function buildCsv(header: string[], rows: string[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

// ── مسودة الفاتورة (إنشاء/تعديل) ──
const AR_DIGITS = "\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669";
/** بيقبل الأرقام العربية والفاصلة العربية/العادية ويرجّعها رقم لاتيني بنقطة عشرية. */
export function normNum(v: string): string {
  return v
    .replace(/[\u0660-\u0669]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[\u066B\u066C,]/g, ".")
    .trim();
}

export interface DraftRow {
  kind: "stock" | "manual";
  inventoryItemId: number | null;
  description: string;
  qty: string;
  price: string;
  /** سعر الصنف من المخزون لو معروف (للعرض والحساب المتوقع بس؛ السيرفر هو اللي بيحسب). */
  catalogPrice?: string | null;
}
export interface Draft {
  orderNumber: string;
  date: string;
  dueDate: string;
  rows: DraftRow[];
}
export type RowError = "pick" | "desc" | "qty" | "price";
export interface DraftErrors {
  number: boolean;
  date: boolean;
  due: boolean;
  items: boolean;
  rows: Array<RowError | null>;
  ok: boolean;
}

export function validateDraft(d: Draft, requireNumber = true): DraftErrors {
  const rows = d.rows.map((r): RowError | null => {
    if (r.kind === "stock" && r.inventoryItemId === null) return "pick";
    if (!validQty(normNum(r.qty))) return "qty";
    if (r.kind === "manual") {
      if (!r.description.trim()) return "desc";
      const p = scaled(normNum(r.price), 2);
      if (p === null || p <= 0n) return "price";
    }
    return null;
  });
  const e = {
    number: requireNumber && !d.orderNumber.trim(),
    date: !d.date,
    due: !!d.dueDate && !!d.date && d.dueDate < d.date,
    items: d.rows.length === 0,
    rows,
  };
  return { ...e, ok: !e.number && !e.date && !e.due && !e.items && rows.every((x) => x === null) };
}

/** الإجمالي المتوقع للمسودة. partial = في بنود سعرها من المخزون ومش معروف هنا. */
export function draftTotal(rows: DraftRow[]): { total: string; partial: boolean } {
  let partial = false;
  const totals = rows.map((r) => {
    const price = r.kind === "stock" ? r.catalogPrice ?? null : normNum(r.price);
    if (price === null || price === "") {
      partial = true;
      return null;
    }
    return lineTotal(normNum(r.qty), price);
  });
  return { total: sumTotals(totals), partial };
}

/** بنود الطلب زي ما السيرفر عايزها. بنود المخزون بتتبعت بسعر 0 (السيرفر بياخد سعر الصنف دايمًا). */
export function toItemsPayload(rows: DraftRow[]): SalesItem[] {
  return rows.map((r) => {
    const qty = normNum(r.qty);
    if (r.kind === "stock") return { inventoryItemId: r.inventoryItemId, description: r.description.trim(), qty, unitPrice: "0", total: "0.00" };
    const price = normNum(r.price);
    return { inventoryItemId: null, description: r.description.trim(), qty, unitPrice: price, total: lineTotal(qty, price) ?? "0.00" };
  });
}
