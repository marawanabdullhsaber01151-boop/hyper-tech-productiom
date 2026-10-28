/** @format */
// قواعد الجودة (عدم المطابقة NCR) بدون أي اتصال بقاعدة البيانات، عشان تتختبر لوحدها.

export const NCR_DISPOSITIONS = ["hold", "rework", "scrap", "sort", "use_as_is"] as const;
export type NcrDisposition = (typeof NCR_DISPOSITIONS)[number];

/** مين يقدر يقفل حالة عدم مطابقة: بعد ما يتأكد من السبب الجذري والإجراء التصحيحي. */
export const NCR_CLOSE_ROLES = ["chairman", "production_manager", "production_quality_controller"] as const;

/** مين يشوف طلبات الإنتاج (نفس دور صفحة الطلبات القديمة). */
export const PRODUCTION_REQUEST_VIEW_ROLES = ["chairman", "supervisor", "production_manager", "warehouse_manager", "storekeeper"] as const;

export type NcrCloseCheck = { ok: true; rootCause: string; correctiveAction: string } | { ok: false; code: "ALREADY_CLOSED" | "ROOT_CAUSE_REQUIRED" | "ACTION_REQUIRED"; message: string };

/** القفل مش بيتم إلا لو الحالة مفتوحة ومكتوب فيها السبب الجذري والإجراء التصحيحي (3 حروف على الأقل لكل واحد). */
export function checkNcrClose(input: { status: string; rootCause?: string | null; correctiveAction?: string | null }): NcrCloseCheck {
  if (input.status === "closed") return { ok: false, code: "ALREADY_CLOSED", message: "حالة عدم المطابقة دي مغلقة بالفعل" };
  const rootCause = (input.rootCause ?? "").trim();
  const correctiveAction = (input.correctiveAction ?? "").trim();
  if (rootCause.length < 3) return { ok: false, code: "ROOT_CAUSE_REQUIRED", message: "اكتب السبب الجذري قبل القفل" };
  if (correctiveAction.length < 3) return { ok: false, code: "ACTION_REQUIRED", message: "اكتب الإجراء التصحيحي قبل القفل" };
  return { ok: true, rootCause, correctiveAction };
}

/**
 * مين يسجّل قرار فحص الجودة على أمر إنتاج. المشرف مش هنا عمدًا: هو اللي نفّذ الشغل،
 * فمايصحش يعتمد جودته بنفسه (فصل المهام). كان السيرفر بيسمح له قبل كده.
 */
export const QUALITY_DECIDE_ROLES = ["production_quality_controller", "quality_engineer", "operations_manager", "executive_manager", "chairman"] as const;

/** نسبة النجاح المطلوبة في العينة لاعتماد الأمر من غير مبرر مكتوب. */
export const QUALITY_PASS_RATE = 95;

export type QualityDoneCheck =
  | { ok: true; rate: number | null }
  | { ok: false; code: "NOTES_REQUIRED_ON_FAIL" | "SAMPLE_OVER_SIZE" | "SAMPLE_INCOMPLETE" | "PASS_BELOW_RATE_NEEDS_NOTES"; message: string };

/**
 * قواعد قرار الجودة (بدون قاعدة بيانات):
 * - الرسوب لازم له سبب مكتوب.
 * - الناجح + الفاشل مايزيدوش عن حجم العينة، ولو في أعداد لازم يكون حجم العينة معروف.
 * - الاعتماد مع نسبة نجاح أقل من الحد لازم له مبرر مكتوب (يتسجّل في سجل التدقيق).
 */
export function checkQualityDone(input: {
  qualityStatus: "passed" | "failed";
  qualityNotes?: string | null;
  sampleSize?: number | null;
  samplePassedCount?: number | null;
  sampleFailedCount?: number | null;
}): QualityDoneCheck {
  const notes = (input.qualityNotes ?? "").trim();
  const size = input.sampleSize ?? null;
  const passed = input.samplePassedCount ?? null;
  const failed = input.sampleFailedCount ?? null;
  if (input.qualityStatus === "failed" && notes.length < 3) return { ok: false, code: "NOTES_REQUIRED_ON_FAIL", message: "سبب الرسوب في الفحص مطلوب" };
  if ((passed !== null || failed !== null) && (size === null || size <= 0)) return { ok: false, code: "SAMPLE_INCOMPLETE", message: "اكتب حجم العينة قبل أعداد الناجح والفاشل" };
  if (size !== null && (passed ?? 0) + (failed ?? 0) > size) return { ok: false, code: "SAMPLE_OVER_SIZE", message: "الناجح والفاشل مجموعهم أكبر من حجم العينة" };
  const rate = size && size > 0 && passed !== null ? Math.round((passed / size) * 100) : null;
  if (input.qualityStatus === "passed" && rate !== null && rate < QUALITY_PASS_RATE && notes.length < 3)
    return { ok: false, code: "PASS_BELOW_RATE_NEEDS_NOTES", message: `نسبة النجاح ${rate}% أقل من ${QUALITY_PASS_RATE}%، اكتب مبرر الاعتماد في الملاحظات` };
  return { ok: true, rate };
}
