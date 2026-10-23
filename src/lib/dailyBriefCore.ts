/** @format */
/**
 * منطق ملخص الصباح (دوال صرفة بدون قاعدة بيانات — قابلة للاختبار مباشرة).
 */
import type { HealthCheck, HealthReport } from "./systemHealthCore";

export const DAILY_BRIEF_TYPE = "daily_brief";
export const DAILY_BRIEF_REF = "system_health";
/** أقصى عدد مشاكل بتتسمّى في نص الملخص (الباقي بيتعدّ وبيتحال لصفحة الصحة). */
export const BRIEF_MAX_ITEMS = 5;
const MAX_LINE = 140;
/** لو اتبعت ملخص في آخر المدة دي ما بنبعتش تاني (الـcron ممكن يتعاد). */
export const BRIEF_DEDUPE_HOURS = 20;

export interface Brief {
  title: string;
  body: string;
  status: HealthReport["status"];
  problems: number;
}

const RANK: Record<string, number> = { bad: 3, warn: 2, unknown: 1, ok: 0 };

const clip = (s: string, n = MAX_LINE) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function composeBrief(report: HealthReport): Brief {
  const all: HealthCheck[] = report.groups.flatMap((g) => g.checks);
  const bad = all.filter((c) => c.status === "bad").length;
  const warn = all.filter((c) => c.status === "warn").length;
  const unknown = all.filter((c) => c.status === "unknown").length;
  const problems = bad + warn;

  if (problems === 0 && unknown === 0) {
    return {
      status: "ok",
      problems: 0,
      title: "صباح الخير — النظام سليم ✓",
      body: `اتفحص ${all.length} بند الصبح وكلهم سليمين. مفيش حاجة محتاجة منك تدخل النهارده.`,
    };
  }

  const worstFirst = all
    .filter((c) => c.status !== "ok")
    .sort((a, b) => (RANK[b.status] ?? 0) - (RANK[a.status] ?? 0) || (b.count ?? 0) - (a.count ?? 0));
  const shown = worstFirst.slice(0, BRIEF_MAX_ITEMS);
  const lines = shown.map((c) => `• ${c.title}: ${clip(c.message)}`);
  const rest = worstFirst.length - shown.length;
  const tally = [bad ? `${bad} مشكلة` : "", warn ? `${warn} ملاحظة` : "", unknown ? `${unknown} غير معروف` : ""].filter(Boolean).join(" · ");
  const head = `الفحص الصباحي لـ${all.length} بند: ${tally}.`;
  const tail = rest > 0 ? `و${rest} كمان — كلهم في صفحة صحة النظام.` : "التفاصيل والحلول في صفحة صحة النظام.";

  return {
    status: report.status,
    problems,
    title: bad ? `ملخص الصباح: ${bad} مشكلة محتاجة تدخل` : warn ? `ملخص الصباح: ${warn} ملاحظة تستاهل نظرة` : "ملخص الصباح: بنود محتاجة فحص يدوي",
    body: [head, ...lines, tail].join("\n"),
  };
}
