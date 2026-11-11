/** @format */
// قواعد اتفاقيات الأسعار (45ب) نقية من غير قاعدة بيانات.
import { MoneyError, toCents } from "./money";
import { isRealDate } from "./workHolidays";

export type AgreementShown = "active" | "upcoming" | "expired" | "ended";
export type AgreementIssue = "BAD_PRICE" | "BAD_FROM" | "BAD_UNTIL" | "ORDER" | "PAST_UNTIL" | "TOO_LONG";

export const MAX_AGREEMENT_DAYS = 730;
const DAY = 86_400_000;
const parse = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** الحالة المعروضة: ended متخزنة، والباقي من التواريخ (يوم النهاية شغال طول اليوم). */
export function agreementShown(a: { status: string; validFrom: string; validUntil: string }, today: string): AgreementShown {
  if (a.status === "ended") return "ended";
  if (a.validUntil < today) return "expired";
  if (a.validFrom > today) return "upcoming";
  return "active";
}

export function agreementIssues(i: { unitPrice: string; validFrom: string; validUntil: string; today: string }): AgreementIssue[] {
  const out = new Set<AgreementIssue>();
  try {
    if (toCents(i.unitPrice) <= 0n) out.add("BAD_PRICE");
  } catch (e) {
    if (e instanceof MoneyError) out.add("BAD_PRICE");
    else throw e;
  }
  const fromOk = isRealDate(i.validFrom);
  const untilOk = isRealDate(i.validUntil);
  if (!fromOk) out.add("BAD_FROM");
  if (!untilOk) out.add("BAD_UNTIL");
  if (fromOk && untilOk) {
    if (i.validUntil < i.validFrom) out.add("ORDER");
    else if (i.validUntil < i.today) out.add("PAST_UNTIL");
    else if ((parse(i.validUntil) - parse(i.validFrom)) / DAY > MAX_AGREEMENT_DAYS) out.add("TOO_LONG");
  }
  return [...out];
}

export const AGREEMENT_ISSUE_TEXT: Record<AgreementIssue, string> = {
  BAD_PRICE: "السعر لازم يكون رقم أكبر من صفر",
  BAD_FROM: "تاريخ البداية غير صحيح",
  BAD_UNTIL: "تاريخ النهاية غير صحيح",
  ORDER: "تاريخ النهاية لازم يكون بعد البداية",
  PAST_UNTIL: "تاريخ النهاية فات",
  TOO_LONG: "أقصى مدة للاتفاقية سنتين",
};

/** فترتين متداخلين (الحدود شاملة). */
export const overlaps = (a: { validFrom: string; validUntil: string }, b: { validFrom: string; validUntil: string }) =>
  a.validFrom <= b.validUntil && b.validFrom <= a.validUntil;

/** الاتفاقية الشغالة النهارده لمنتج (لو في أكتر من واحدة، الأحدث إنشاءً). */
export function pickAgreement<T extends { id: number; bomRecipeId: number; status: string; validFrom: string; validUntil: string }>(list: readonly T[], recipeId: number, today: string): T | null {
  const live = list.filter((a) => a.bomRecipeId === recipeId && agreementShown(a, today) === "active");
  return live.length === 0 ? null : live.reduce((m, a) => (a.id > m.id ? a : m));
}

/** مدير يقدر يبعت عرض فوق الحد؟ (حد 0 = مفيش حد) */
export function sendBlocked(input: { totalCents: bigint; limit: number; isManager: boolean }): boolean {
  return input.limit > 0 && !input.isManager && input.totalCents > BigInt(input.limit) * 100n;
}

export const QUOTE_MANAGER_ROLES = ["chairman", "executive_manager", "sales_manager"] as const;
