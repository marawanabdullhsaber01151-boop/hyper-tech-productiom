/** @format */
// الترحيل التلقائي (49أ): قواعد نقية من غير قاعدة بيانات. المبدأ: «التقارب». بدل ما نتتبّع كل انتقال حالة،
// بنحسب القيمة المفروض تكون مسجّلة دلوقتي (حسب حالة الأمر وإجماليه) ونقارنها بالمسجّل فعلًا، ونرحّل الفرق بس.
// كده أي تعديل (حالة، بنود، إلغاء، حذف) بيوصل لنفس الصح، وتكراره ما بيعملش قيد زيادة.
import { toCents } from "./money";
import type { EntryLineInput } from "./ledgerCore";

export const AUTO_ACCOUNT_CODES = {
  receivable: "1130",
  sales: "4100",
  suppliers: "2110",
} as const;
export const STOCK_ACCOUNT_BY_CATEGORY: Record<string, string> = { raw_material: "1150", wip: "1160", finished_good: "1170" };
export const stockAccountCode = (category: string | null | undefined): string => STOCK_ACCOUNT_BY_CATEGORY[category ?? ""] ?? "1150";

export const SOURCE_SALES_INVOICE = "sales_invoice";
export const SOURCE_PURCHASE_RECEIPT = "purchase_receipt";
export const AUTO_SETTING_KEY = "ledger.auto_posting_from";

/** حالات الأمر اللي بيبقى فيها إيراد مُثبَّت: مؤكد وشُحن ودُفع. الباقي (مسودة، انتظار اعتماد، ملغي) صفر. */
export const REVENUE_STATUSES: readonly string[] = ["confirmed", "shipped", "paid"];

export function salesTargetCents(status: string, total: string | number): bigint {
  return REVENUE_STATUSES.includes(status) ? toCents(total) : 0n;
}

export interface RevenueDelta { kind: "invoice" | "credit"; cents: bigint }

/** الفرق بين المفروض والمسجّل. موجب = فاتورة إضافية، سالب = إشعار دائن (تخفيض/إلغاء). */
export function revenueDelta(targetCents: bigint, currentCents: bigint): RevenueDelta | null {
  const d = targetCents - currentCents;
  if (d === 0n) return null;
  return d > 0n ? { kind: "invoice", cents: d } : { kind: "credit", cents: -d };
}

/** الأمر بيتتبّع لو تاريخه من يوم التشغيل أو بعده، أو لو له قيود سابقة (الاستمرارية أهم). */
export function isTracked(orderDate: string | null | undefined, start: string | null, hasEntries: boolean): boolean {
  if (!start) return false;
  if (hasEntries) return true;
  return Boolean(orderDate) && String(orderDate).slice(0, 10) >= start;
}

export const centsDecimal = (c: bigint): string => `${c / 100n}.${String(c % 100n).padStart(2, "0")}`;

export function salesEntryLines(delta: RevenueDelta, receivableId: number, salesId: number, memo: string): EntryLineInput[] {
  const amount = centsDecimal(delta.cents);
  return delta.kind === "invoice"
    ? [{ accountId: receivableId, debit: amount, memo }, { accountId: salesId, credit: amount, memo }]
    : [{ accountId: salesId, debit: amount, memo }, { accountId: receivableId, credit: amount, memo }];
}

export interface ReceiptLine { category: string | null; qty: string; unitPrice: string }
export interface ReceiptValuation { totalCents: bigint; byAccount: Map<string, bigint> }

/** قيمة الاستلام المقبول: كمية × سعر البند (تقريب مرة واحدة لكل سطر)، مجمّعة حسب حساب المخزون. */
export function valueReceipt(lines: readonly ReceiptLine[], lineCents: (qty: string, price: string) => bigint): ReceiptValuation {
  const byAccount = new Map<string, bigint>();
  let total = 0n;
  for (const l of lines) {
    const c = lineCents(l.qty, l.unitPrice);
    if (c <= 0n) continue;
    const code = stockAccountCode(l.category);
    byAccount.set(code, (byAccount.get(code) ?? 0n) + c);
    total += c;
  }
  return { totalCents: total, byAccount };
}

/** «YYYY-MM-DD» صحيح وبقيمة تقويمية حقيقية. */
export const isIsoDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export type AutoPostingChange = { ok: true } | { ok: false; code: "LOCKED" | "PAST" | "BAD_DATE" };
/** قواعد تغيير تاريخ التشغيل: مقفول بمجرد وجود قيد تلقائي، والتاريخ مش في الماضي (عشان مفيش فجوات). */
export function checkAutoPostingChange(next: string | null, today: string, autoEntryCount: number): AutoPostingChange {
  if (autoEntryCount > 0) return { ok: false, code: "LOCKED" };
  if (next === null) return { ok: true };
  if (!isIsoDay(next)) return { ok: false, code: "BAD_DATE" };
  if (next < today) return { ok: false, code: "PAST" };
  return { ok: true };
}
