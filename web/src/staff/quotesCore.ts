/** منطق عروض الأسعار النقي (45أ). السيرفر هو الحَكَم (src/lib/priceQuoteCore.ts)، هنا فحص سريع قبل الإرسال وعرض فقط. */
import type { Tone } from "../design/components";

export type QuoteShown = "draft" | "sent" | "ordered" | "declined" | "cancelled" | "expired";
export const QUOTE_FILTERS: readonly QuoteShown[] = ["draft", "sent", "ordered", "declined", "expired", "cancelled"];

export interface QuoteLine { id?: number; bomRecipeId: number; productName: string; qty: string; unitPrice: string }
export interface Quote {
  id: number;
  quoteNumber: string;
  portalCustomerId: number;
  customerName: string;
  status: QuoteShown;
  validUntil: string;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
  sentAt: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  declineReason: string | null;
  cancelReason: string | null;
  batchRef: string | null;
  total: string;
  canEdit: boolean;
  canSend: boolean;
  canCancel: boolean;
  lines: QuoteLine[];
}
export interface QuoteList { items: Quote[]; counts: Record<string, number> }
export interface QuoteLookups {
  companies: { id: number; name: string }[];
  recipes: { id: number; name: string; referencePrice: string | null }[];
  defaultValidUntil: string;
}

export const statusTone = (s: QuoteShown): Tone =>
  s === "sent" ? "info" : s === "ordered" ? "success" : s === "declined" || s === "cancelled" ? "danger" : s === "expired" ? "warn" : "neutral";

export interface FormLine { key: number; bomRecipeId: string; qty: string; unitPrice: string }
export interface QuoteForm { customerId: string; validUntil: string; notes: string; lines: FormLine[] }

export type FormIssue = "customer" | "date" | "noLines" | "product" | "qty" | "price" | "duplicate";

const QTY = /^(?=.*[1-9])[0-9]{1,6}(?:\.[0-9]{1,3})?$/;
const PRICE = /^[0-9]{1,8}(?:\.[0-9]{1,4})?$/;

export function formIssues(f: QuoteForm): FormIssue[] {
  const out = new Set<FormIssue>();
  if (!f.customerId) out.add("customer");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.validUntil)) out.add("date");
  if (f.lines.length === 0) out.add("noLines");
  const seen = new Set<string>();
  for (const l of f.lines) {
    if (!l.bomRecipeId) out.add("product");
    else if (seen.has(l.bomRecipeId)) out.add("duplicate");
    seen.add(l.bomRecipeId);
    if (!QTY.test(l.qty.trim())) out.add("qty");
    if (!PRICE.test(l.unitPrice.trim()) || Number(l.unitPrice) <= 0) out.add("price");
  }
  return [...out];
}

export function toPayload(f: QuoteForm) {
  return {
    portalCustomerId: Number(f.customerId),
    validUntil: f.validUntil,
    notes: f.notes.trim() || null,
    lines: f.lines.map((l) => ({ bomRecipeId: Number(l.bomRecipeId), qty: l.qty.trim(), unitPrice: l.unitPrice.trim() })),
  };
}

export function emptyForm(validUntil: string): QuoteForm {
  return { customerId: "", validUntil, notes: "", lines: [{ key: 1, bomRecipeId: "", qty: "", unitPrice: "" }] };
}

export function formFromQuote(q: Quote): QuoteForm {
  return {
    customerId: String(q.portalCustomerId),
    validUntil: q.validUntil,
    notes: q.notes ?? "",
    lines: q.lines.map((l, i) => ({ key: i + 1, bomRecipeId: String(l.bomRecipeId), qty: l.qty, unitPrice: l.unitPrice })),
  };
}

/** إجمالي السطر للعرض فقط (تقريب لأقرب قرش). */
export const lineEstimate = (qty: string, price: string): number => {
  const n = Number(qty) * Number(price);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

export const formEstimate = (f: QuoteForm): number => Math.round(f.lines.reduce((s, l) => s + lineEstimate(l.qty, l.unitPrice), 0) * 100) / 100;

/** باقي أيام الصلاحية (سالب = منتهي). */
export function daysLeft(validUntil: string, today: string): number {
  return Math.round((Date.parse(`${validUntil}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}
