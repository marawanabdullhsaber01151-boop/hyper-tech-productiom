/** @format */
// الفاتورة الإلكترونية (56): أنواع الرد من السيرفر وتنسيق نص الفحص. من غير React علشان يتختبر بسهولة.
export interface InvoiceLine { description: string; qty: string; unitPrice: string; total: string }
export interface Invoice {
  id: number; invoiceNumber: string; orderId: number; orderNumber: string; customerName: string; issueDate: string;
  subtotal: string; taxRate: string; taxAmount: string; total: string; lines: InvoiceLine[]; seal: string; sealKeyId: string;
  issuedByName: string; issuedAt: string; verifyUrl: string;
}
export interface InvoiceListRow {
  id: number; invoiceNumber: string; orderNumber: string; customerName: string; issueDate: string; total: string; issuedByName: string;
}
export interface Integrity {
  keyConfigured: boolean; keyId: string | null; total: number; ok: boolean; badSeals: string[]; otherKey: string[];
  gaps: { missing: string[]; duplicates: string[]; malformed: string[] };
}
export type VerifyState = "valid" | "tampered" | "wrong_token" | "unknown" | "unverifiable";
export const VERIFY_STATES: readonly VerifyState[] = ["valid", "tampered", "wrong_token", "unknown", "unverifiable"];

/** الأمر ممكن يتفوتر في الحالات دي بس (نفس قاعدة السيرفر). */
export const INVOICEABLE = ["confirmed", "shipped", "paid"] as const;
export const isInvoiceable = (status: string): boolean => (INVOICEABLE as readonly string[]).includes(status);

/** أول {max} رقم من القائمة + «و{n} كمان» (علشان الفحص ميطلعش سطر بطول الصفحة). */
export function shortList(items: readonly string[], max = 5): string {
  if (items.length <= max) return items.join(", ");
  return `${items.slice(0, max).join(", ")} +${items.length - max}`;
}
