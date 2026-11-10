/** @format */
// قواعد عروض الأسعار (45أ) نقية من غير قاعدة بيانات: حالات، صلاحية، تحقق السطور، الإجمالي، ورقم العرض.
import { MoneyError, priceLines, toCents } from "./money";
import { isRealDate } from "./workHolidays";

export const QUOTE_STATUSES = ["draft", "sent", "ordered", "declined", "cancelled"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
/** الحالة المعروضة: «sent» بعد تاريخ الصلاحية = «expired» (بتتحسب وقت القراءة، مش متخزنة). */
export type QuoteShownStatus = QuoteStatus | "expired";

export const MAX_QUOTE_LINES = 50;
export const MAX_VALIDITY_DAYS = 365;

const DAY = 86_400_000;
const parse = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const addDays = (iso: string, n: number) => new Date(parse(iso) + n * DAY).toISOString().slice(0, 10);

export const isQuoteStatus = (s: string): s is QuoteStatus => (QUOTE_STATUSES as readonly string[]).includes(s);

export function effectiveStatus(status: string, validUntil: string, today: string): QuoteShownStatus {
  if (status === "sent" && validUntil < today) return "expired";
  return isQuoteStatus(status) ? status : "cancelled";
}

/** آخر يوم صلاحية الافتراضي: النهارده + عدد الأيام (العرض شغال طول اليوم الأخير). */
export function defaultValidUntil(today: string, days: number): string {
  const d = Number.isInteger(days) && days >= 1 && days <= MAX_VALIDITY_DAYS ? days : 14;
  return addDays(today, d);
}

export const canEdit = (status: string) => status === "draft";
export const canSend = (status: string) => status === "draft";
export const canCancel = (status: string) => status === "draft" || status === "sent";

export interface QuoteLineInput {
  bomRecipeId: number;
  qty: string;
  unitPrice: string;
}

export type QuoteIssue = "NO_LINES" | "TOO_MANY" | "DUPLICATE_PRODUCT" | "BAD_QTY" | "BAD_PRICE" | "BAD_DATE" | "PAST_DATE" | "TOO_FAR";

const QTY = /^(?=.*[1-9])[0-9]{1,6}(?:\.[0-9]{1,3})?$/;

/** كل المشاكل مرة واحدة (مش أول واحدة بس) عشان الموظف يصلّحها كلها. */
export function quoteIssues(input: { lines: readonly QuoteLineInput[]; validUntil: string; today: string }): QuoteIssue[] {
  const out = new Set<QuoteIssue>();
  if (input.lines.length === 0) out.add("NO_LINES");
  if (input.lines.length > MAX_QUOTE_LINES) out.add("TOO_MANY");
  const seen = new Set<number>();
  for (const l of input.lines) {
    if (seen.has(l.bomRecipeId)) out.add("DUPLICATE_PRODUCT");
    seen.add(l.bomRecipeId);
    if (!QTY.test(l.qty)) out.add("BAD_QTY");
    try {
      if (toCents(l.unitPrice) <= 0n) out.add("BAD_PRICE");
    } catch (e) {
      if (e instanceof MoneyError) out.add("BAD_PRICE");
      else throw e;
    }
  }
  if (!isRealDate(input.validUntil)) out.add("BAD_DATE");
  else if (input.validUntil < input.today) out.add("PAST_DATE");
  else if (input.validUntil > addDays(input.today, MAX_VALIDITY_DAYS)) out.add("TOO_FAR");
  return [...out];
}

export const ISSUE_TEXT: Record<QuoteIssue, string> = {
  NO_LINES: "ضيف منتج واحد على الأقل",
  TOO_MANY: `أقصى عدد منتجات في العرض ${MAX_QUOTE_LINES}`,
  DUPLICATE_PRODUCT: "في منتج متكرر، ادمج الكميات في سطر واحد",
  BAD_QTY: "الكمية لازم تكون رقم أكبر من صفر (لحد 3 خانات عشرية)",
  BAD_PRICE: "السعر لازم يكون رقم أكبر من صفر",
  BAD_DATE: "تاريخ الصلاحية غير صحيح",
  PAST_DATE: "تاريخ الصلاحية فات",
  TOO_FAR: "تاريخ الصلاحية بعيد (أقصى مدة سنة)",
};

/** إجمالي العرض بالقروش الصحيحة: كل سطر يتقرّب مرة، والإجمالي = مجموع السطور. */
export function quoteTotal(lines: ReadonlyArray<{ qty: string; unitPrice: string }>): string {
  return priceLines(lines).subtotal;
}

/** رقم العرض: QT-YYMM-0001. بيكمّل من آخر رقم في نفس الشهر. */
export function nextQuoteNumber(now: Date, lastNumber: string | null): string {
  const yy = String(now.getUTCFullYear()).slice(2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const prefix = `QT-${yy}${mm}`;
  const last = lastNumber && lastNumber.startsWith(`${prefix}-`) ? parseInt(lastNumber.split("-").pop() ?? "0", 10) || 0 : 0;
  return `${prefix}-${String(last + 1).padStart(4, "0")}`;
}

export type OrderRefusal = "NOT_FOUND" | "NOT_SENT" | "EXPIRED" | "DONE";

/** هل العميل يقدر يطلب من العرض ده دلوقتي؟ null = أيوه. */
export function orderRefusal(quote: { status: string; validUntil: string; portalCustomerId: number } | null, customerId: number, today: string): OrderRefusal | null {
  if (!quote || quote.portalCustomerId !== customerId) return "NOT_FOUND";
  if (quote.status === "ordered") return "DONE";
  const shown = effectiveStatus(quote.status, quote.validUntil, today);
  if (shown === "expired") return "EXPIRED";
  if (shown !== "sent") return "NOT_SENT";
  return null;
}

export const ORDER_REFUSAL_TEXT: Record<OrderRefusal, string> = {
  NOT_FOUND: "العرض ده مش موجود",
  NOT_SENT: "العرض ده مش متاح للطلب",
  EXPIRED: "العرض ده انتهت صلاحيته، اطلب من المبيعات عرض جديد",
  DONE: "اتطلب من العرض ده قبل كده",
};

/** السعر المتفق عليه مقفول: لازم السعر وقت المراجعة يساوي المتفق عليه بالقرش. null = سليم. */
export function agreedPriceIssue(agreed: string | null, entered: string): string | null {
  if (agreed === null) return null;
  try {
    return toCents(agreed) === toCents(entered) ? null : agreed;
  } catch {
    return agreed;
  }
}
