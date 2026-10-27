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
