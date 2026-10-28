/** قواعد شاشة «فحص الجودة». لازم تتطابق مع checkQualityDone في src/lib/productionQualityCore.ts (السيرفر هو الحَكَم). */

/** نفس QUALITY_DECIDE_ROLES في السيرفر (المشرف مش منهم: فصل المهام). */
export const QUALITY_DECIDE_ROLES = ["chairman", "executive_manager", "operations_manager", "production_quality_controller", "quality_engineer"] as const;
/** مين يشوف كل أوامر الفحص (الباقي بيشوف المسنودة له بس). */
export const QUALITY_SEE_ALL_ROLES = ["chairman", "executive_manager", "operations_manager", "quality_engineer"] as const;
export const QUALITY_PASS_RATE = 95;

export const canDecideQuality = (role: string) => (QUALITY_DECIDE_ROLES as readonly string[]).includes(role);

export interface InspectableOrder { workflowStatus: string; qualityControllerUserId?: number | null }

/** الأوامر اللي في انتظار الفحص ومسموح للمستخدم يقرر فيها. */
export function inspectable<T extends InspectableOrder>(orders: readonly T[], role: string, userId: number | undefined): T[] {
  const all = (QUALITY_SEE_ALL_ROLES as readonly string[]).includes(role);
  return orders.filter((o) => o.workflowStatus === "quality_check" && (all || (userId !== undefined && o.qualityControllerUserId === userId)));
}

const toInt = (s: string): number | null => {
  const v = s.trim();
  if (!/^\d+$/.test(v)) return null;
  return Number(v);
};

export interface InspectionInput {
  status: "passed" | "failed";
  notes: string;
  size: string;
  passed: string;
  failed: string;
}

/** نسبة النجاح في العينة (٪ مقربة)، أو null لو البيانات ناقصة. */
export function sampleRate(size: string, passed: string): number | null {
  const s = toInt(size);
  const p = toInt(passed);
  if (!s || p === null) return null;
  return Math.round((p / s) * 100);
}

export const predictedVerdict = (rate: number | null): "pass" | "fail" | null => (rate === null ? null : rate >= QUALITY_PASS_RATE ? "pass" : "fail");

/** الفاشل المحسوب تلقائيًا = حجم العينة − الناجح (لو الاتنين أرقام صحيحة والناجح ≤ الحجم). */
export function autoFailed(size: string, passed: string): string {
  const s = toInt(size);
  const p = toInt(passed);
  return s !== null && p !== null && p <= s ? String(s - p) : "";
}

export type InspectionError = "notesOnFail" | "sampleIncomplete" | "sampleOver" | "lowRateNeedsNotes" | "badNumber";

/** نفس قواعد السيرفر بالظبط، عشان الزرار يتقفل قبل الإرسال ويظهر السبب. */
export function inspectionError(v: InspectionInput): InspectionError | null {
  const notes = v.notes.trim();
  for (const x of [v.size, v.passed, v.failed]) if (x.trim() && toInt(x) === null) return "badNumber";
  const size = toInt(v.size);
  const passed = v.passed.trim() ? toInt(v.passed) : null;
  const failed = v.failed.trim() ? toInt(v.failed) : null;
  if (v.status === "failed" && notes.length < 3) return "notesOnFail";
  if ((passed !== null || failed !== null) && (size === null || size <= 0)) return "sampleIncomplete";
  if (size !== null && (passed ?? 0) + (failed ?? 0) > size) return "sampleOver";
  const rate = size && size > 0 && passed !== null ? Math.round((passed / size) * 100) : null;
  if (v.status === "passed" && rate !== null && rate < QUALITY_PASS_RATE && notes.length < 3) return "lowRateNeedsNotes";
  return null;
}

/** الجسم اللي بيتبعت للسيرفر (أرقام أو null، من غير حقول فاضية). */
export function inspectionBody(v: InspectionInput, rating: number | null, defectTags: string[], checklist: Array<{ label: string; ok: boolean }>) {
  const n = (s: string) => (s.trim() ? toInt(s) : null);
  return {
    qualityStatus: v.status,
    qualityNotes: v.notes.trim() || null,
    performanceRating: rating,
    sampleSize: n(v.size),
    samplePassedCount: n(v.passed),
    sampleFailedCount: n(v.failed),
    defectTags,
    checklist,
  };
}

/** إضافة عيب من غير تكرار (بنفس الاسم بعد التنضيف). */
export function addTag(tags: readonly string[], raw: string): string[] {
  const t = raw.trim();
  return t && !tags.includes(t) ? [...tags, t] : [...tags];
}

/** أكتر العيوب اتسجّلت قبل كده (للاقتراح بدل الكتابة). */
export function topTags(records: ReadonlyArray<{ defectTags?: unknown }>, limit = 6): string[] {
  const n = new Map<string, number>();
  for (const r of records) if (Array.isArray(r.defectTags)) for (const x of r.defectTags) if (typeof x === "string" && x.trim()) n.set(x.trim(), (n.get(x.trim()) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([x]) => x);
}

export const checklistScore = (items: ReadonlyArray<{ ok: boolean }>) => ({ ok: items.filter((i) => i.ok).length, total: items.length });
