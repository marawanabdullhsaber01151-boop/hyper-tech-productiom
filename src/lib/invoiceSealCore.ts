/** @format */
// الفاتورة الإلكترونية الداخلية (56): القواعد الصافية (من غير قاعدة بيانات). الختم HMAC-SHA256 بمفتاح INVOICE_SEAL_KEY.
// مفيش أي اتصال بمصلحة الضرائب: الختم والرابط والـQR لإثبات إن الفاتورة طالعة من النظام ومتعدّلتش.
import { createHmac, timingSafeEqual } from "node:crypto";
import { centsToString, toCents } from "./money";

export const SEAL_VERSION = 1;
export const SEAL_KEY_MIN = 32;
/** طول الجزء اللي بيتحط في رابط التحقق من الختم (80 بت، كفاية لمنع التخمين مع حد الطلبات). */
export const TOKEN_LEN = 20;
export const INVOICEABLE_STATUSES = ["confirmed", "shipped", "paid"] as const;
export const INVOICE_PREFIX = "INV-";
export const INVOICE_PAD = 6;

export interface InvoiceLine { description: string; qty: string; unitPrice: string; total: string }
export interface InvoiceData {
  invoiceNumber: string;
  orderNumber: string;
  issueDate: string;
  customerName: string;
  subtotal: string;
  taxRate: string;
  taxAmount: string;
  total: string;
  lines: InvoiceLine[];
}

export const canInvoice = (status: string): boolean => (INVOICEABLE_STATUSES as readonly string[]).includes(status);

/** مفتاح صالح: موجود وطوله 32 حرف على الأقل (بنرفض القيم الضعيفة). */
export function sealKeyProblem(key: string | undefined | null): "missing" | "short" | null {
  const k = (key ?? "").trim();
  if (!k) return "missing";
  return k.length < SEAL_KEY_MIN ? "short" : null;
}

const money = (v: string): string => centsToString(toCents(v));
const qty3 = (v: string): string => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(3) : v;
};

/** الصيغة الثابتة اللي بتتختم: ترتيب الحقول ثابت، والأرقام متوحّدة، فنفس الفاتورة دايمًا نفس النص. */
export function canonicalString(inv: InvoiceData): string {
  return JSON.stringify([
    `v${SEAL_VERSION}`,
    inv.invoiceNumber,
    inv.orderNumber,
    inv.issueDate,
    inv.customerName.trim(),
    money(inv.subtotal),
    Number(inv.taxRate).toFixed(2),
    money(inv.taxAmount),
    money(inv.total),
    inv.lines.map((l) => [l.description.trim(), qty3(l.qty), money(l.unitPrice), money(l.total)]),
  ]);
}

export function sealOf(inv: InvoiceData, key: string): string {
  return createHmac("sha256", key.trim()).update(canonicalString(inv)).digest("hex");
}

/** بصمة المفتاح (مش المفتاح): بتقولنا أنهي مفتاح ختم الفاتورة من غير ما تكشفه. */
export function keyIdOf(key: string): string {
  return createHmac("sha256", key.trim()).update("invoice-seal-key-id").digest("hex").slice(0, 8);
}

export const tokenOf = (seal: string): string => seal.slice(0, TOKEN_LEN);

/** مقارنة بتوقيت ثابت (ضد هجمات التوقيت). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type VerifyState = "valid" | "tampered" | "wrong_token" | "unknown" | "unverifiable";

/**
 * حكم التحقق العام:
 *  - unknown: مفيش فاتورة بالرقم ده.
 *  - wrong_token: الرابط مش مطابق للختم المحفوظ (رقم صح وتوكن غلط).
 *  - unverifiable: المفتاح مش متضبط عندنا فمنقدرش نعيد حساب الختم (مش بنقول «سليمة» من غير إثبات).
 *  - tampered: الختم المحسوب من بيانات الفاتورة الحالية غير المحفوظ (البيانات اتغيّرت).
 */
export function verifyVerdict(input: { found: boolean; storedSeal?: string; token: string; recomputed: string | null }): VerifyState {
  if (!input.found || !input.storedSeal) return "unknown";
  if (!safeEqual(tokenOf(input.storedSeal), input.token)) return "wrong_token";
  if (input.recomputed === null) return "unverifiable";
  return safeEqual(input.recomputed, input.storedSeal) ? "valid" : "tampered";
}

/** ضريبة القيمة المضافة «مشمولة في السعر»: الإجمالي ما بيتغيّرش (علشان القيد والرصيد). الضريبة = الإجمالي × نسبة ÷ (100 + نسبة). */
export function vatInclusive(total: string, ratePercent: number): { taxRate: string; taxAmount: string } {
  const bp = BigInt(Math.round(ratePercent * 100));
  if (bp <= 0n) return { taxRate: "0.00", taxAmount: "0.00" };
  const cents = toCents(total);
  const tax = (cents * bp + (10000n + bp) / 2n) / (10000n + bp);
  return { taxRate: (Number(bp) / 100).toFixed(2), taxAmount: centsToString(tax) };
}

/** رقم الفاتورة: بادئة + أصفار + الرقم. بيرجّع الرقم أو null لو الشكل غلط. */
export function parseInvoiceNumber(n: string): number | null {
  const m = new RegExp(`^${INVOICE_PREFIX}(\\d{${INVOICE_PAD},})$`).exec(n);
  return m ? Number(m[1]) : null;
}

/** الفجوات في الترقيم: أرقام ناقصة بين الأول والأخير، وتكرار، وأرقام بشكل غلط. */
export function findGaps(numbers: readonly string[]): { missing: string[]; duplicates: string[]; malformed: string[] } {
  const seen = new Set<number>();
  const duplicates: string[] = [];
  const malformed: string[] = [];
  for (const n of numbers) {
    const v = parseInvoiceNumber(n);
    if (v === null) { malformed.push(n); continue; }
    if (seen.has(v)) duplicates.push(n);
    seen.add(v);
  }
  const missing: string[] = [];
  if (seen.size) {
    const sorted = [...seen].sort((a, b) => a - b);
    for (let v = sorted[0]!; v <= sorted[sorted.length - 1]!; v++) if (!seen.has(v)) missing.push(`${INVOICE_PREFIX}${String(v).padStart(INVOICE_PAD, "0")}`);
  }
  return { missing, duplicates, malformed };
}

/** رابط التحقق العام اللي بيتحط في الـQR. */
export function verifyUrl(base: string, invoiceNumber: string, seal: string): string {
  const u = new URL("/v2/verify", base);
  u.searchParams.set("n", invoiceNumber);
  u.searchParams.set("t", tokenOf(seal));
  return u.toString();
}

export const tokenShape = /^[0-9a-f]{20}$/;
export const numberShape = /^INV-\d{6,}$/;
