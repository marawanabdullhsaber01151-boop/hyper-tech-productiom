/** @format */
// قواعد تصنيف تكرار جهات الاتصال (الخطوة 38ب). التشابه نفسه بيتحسب في القاعدة بـpg_trgm، والتصنيف والترتيب هنا.

/** أقل تشابه (0..1) نعتبره «ممكن مكرر». pg_trgm بيدّي 1 للمتطابق. */
export const SIMILAR_MIN = 0.5;

export type MatchReason = "phone" | "company" | "similar";

export interface MatchInput { phoneHit: boolean; companyHit: boolean; score: number }

/** الأقوى أولاً: نفس التليفون، ثم نفس الشركة (مطابق أو يحتوي)، ثم تشابه بالاسم. null = مش مكرر. */
export function classifyMatch(m: MatchInput): MatchReason | null {
  if (m.phoneHit) return "phone";
  if (m.companyHit) return "company";
  return m.score >= SIMILAR_MIN ? "similar" : null;
}

const RANK: Record<MatchReason, number> = { phone: 0, company: 1, similar: 2 };

export function rankMatches<T extends MatchInput & { id: number }>(rows: readonly T[]): Array<T & { reason: MatchReason }> {
  const out: Array<T & { reason: MatchReason }> = [];
  for (const r of rows) {
    const reason = classifyMatch(r);
    if (reason) out.push({ ...r, reason });
  }
  return out.sort((a, b) => RANK[a.reason] - RANK[b.reason] || b.score - a.score || a.id - b.id);
}

/** نص البحث بالاحتواء: لازم 3 حروف على الأقل عشان ما نجيبش نصف الجدول. وبنهرّب علامات LIKE. */
export function containsPattern(raw: string): string | null {
  const s = raw.trim();
  if (s.length < 3) return null;
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
