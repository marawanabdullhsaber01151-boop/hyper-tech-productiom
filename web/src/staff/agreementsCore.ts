/** منطق اتفاقيات الأسعار النقي (45ب). السيرفر هو الحَكَم (src/lib/priceAgreementCore.ts). */
import type { Tone } from "../design/components";

export type AgreementShown = "active" | "upcoming" | "expired" | "ended";
export const AGREEMENT_FILTERS: readonly AgreementShown[] = ["active", "upcoming", "expired", "ended"];

export interface Agreement {
  id: number;
  portalCustomerId: number;
  customerName: string;
  bomRecipeId: number;
  productName: string;
  unitPrice: string;
  validFrom: string;
  validUntil: string;
  note: string | null;
  status: AgreementShown;
  createdByName: string | null;
  endedByName: string | null;
  endReason: string | null;
}
export interface AgreementList { items: Agreement[]; counts: Record<string, number> }

export const agreementTone = (s: AgreementShown): Tone => (s === "active" ? "success" : s === "upcoming" ? "info" : s === "expired" ? "warn" : "neutral");

export interface AgreementForm { customerId: string; recipeId: string; unitPrice: string; validFrom: string; validUntil: string; note: string }
export type AgreementIssue = "customer" | "product" | "price" | "from" | "until" | "order";

const PRICE = /^[0-9]{1,8}(?:\.[0-9]{1,4})?$/;

export function agreementIssues(f: AgreementForm): AgreementIssue[] {
  const out: AgreementIssue[] = [];
  if (!f.customerId) out.push("customer");
  if (!f.recipeId) out.push("product");
  if (!PRICE.test(f.unitPrice.trim()) || Number(f.unitPrice) <= 0) out.push("price");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.validFrom)) out.push("from");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.validUntil)) out.push("until");
  if (!out.includes("from") && !out.includes("until") && f.validUntil < f.validFrom) out.push("order");
  return out;
}

export const emptyAgreement = (today: string, until: string): AgreementForm => ({ customerId: "", recipeId: "", unitPrice: "", validFrom: today, validUntil: until, note: "" });

export const agreementPayload = (f: AgreementForm) => ({
  portalCustomerId: Number(f.customerId),
  bomRecipeId: Number(f.recipeId),
  unitPrice: f.unitPrice.trim(),
  validFrom: f.validFrom,
  validUntil: f.validUntil,
  note: f.note.trim() || null,
});
