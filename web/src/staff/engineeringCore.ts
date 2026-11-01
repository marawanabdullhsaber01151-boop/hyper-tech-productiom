/**
 * منطق شاشة الهندسة (خطوة 33أ): إصدارات المنتج وطلبات التغيير. بدون واجهة عشان يتختبر لوحده.
 * لازم يتطابق مع src/routes/engineering.ts وsrc/domain/engineering-governance.ts (السيرفر هو الحَكَم).
 */

/** نفس engineeringRoles في السيرفر: مين يشوف ويعدّل. */
export const ENGINEERING_ROLES = ["chairman", "production_manager", "production_controller", "production_quality_controller"] as const;
/** نفس engineeringApprovalRoles: مين يعتمد ويصدر ويستبدل ويوقف ويبت في التغيير (غير المحرر، فصل مهام). */
export const ENGINEERING_APPROVAL_ROLES = ["chairman", "production_manager", "production_quality_controller"] as const;

const has = (list: readonly string[], role: string) => list.includes(role);
export const canEditEngineering = (role: string) => has(ENGINEERING_ROLES, role);
export const canApproveEngineering = (role: string) => has(ENGINEERING_APPROVAL_ROLES, role);

export const VERSION_STATUSES = ["draft", "in_review", "approved", "released", "superseded", "retired"] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];
/** مراحل الدورة بالترتيب (superseded وretired خارج المسار الرئيسي). */
export const VERSION_FLOW = ["draft", "in_review", "approved", "released"] as const;

export const isEditableStatus = (s: string) => s === "draft" || s === "in_review";

export type VersionAction = "validate" | "submitReview" | "approve" | "release" | "supersede" | "retire";

export interface VersionLike { status: string; validationStatus: string }

/** الإجراءات المتاحة على إصدار حسب الدور والحالة (نفس قواعد السيرفر). */
export function versionActions(role: string, v: VersionLike): VersionAction[] {
  const out: VersionAction[] = [];
  const edit = canEditEngineering(role);
  const approve = canApproveEngineering(role);
  if (edit && isEditableStatus(v.status)) out.push("validate");
  if (edit && v.status === "draft") out.push("submitReview");
  if (approve && v.status === "in_review") out.push("approve");
  if (approve && v.status === "approved") out.push("release");
  if (approve && v.status === "released") out.push("supersede");
  if (approve && (v.status === "released" || v.status === "superseded")) out.push("retire");
  return out;
}

/** ليه الاعتماد مقفول: لازم فحص قابلية ناجح وحديث (أي تعديل بيرجّعه «لم يُفحص»). */
export const approveBlocked = (v: VersionLike) => v.validationStatus !== "passed";

export const COMPONENT_TYPES = ["raw_material", "sub_assembly", "substitute", "co_product", "by_product"] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];

export const QTY_RE = /^\d+(\.\d{1,4})?$/;
export const SCRAP_RE = /^\d{1,3}(\.\d{1,3})?$/;

/** رقم السطر الجاي: أكبر رقم + 1 (يتقال مرة واحدة بدل ما المستخدم يكتبه). */
export const nextLineNo = (rows: readonly { lineNo: number }[]) => rows.reduce((m, r) => Math.max(m, r.lineNo), 0) + 1;
/** رقم العملية الجاية بخطوة 10 (10، 20، 30...) عشان يفضل مكان لعملية في النص. */
export const nextOperationNo = (rows: readonly { operationNo: number }[]) => (Math.floor(rows.reduce((m, r) => Math.max(m, r.operationNo), 0) / 10) + 1) * 10;

export interface ComponentForm {
  lineNo: number;
  componentType: string;
  itemId: string;
  subProductId: string;
  qty: string;
  unit: string;
  scrap: string;
  alternateGroup: string;
  notes: string;
}
export type ComponentError = "source" | "qty" | "unit" | "scrap" | null;

export const isSubAssembly = (type: string) => type === "sub_assembly";

export function componentError(f: ComponentForm): ComponentError {
  if (isSubAssembly(f.componentType) ? !f.subProductId : !f.itemId) return "source";
  if (!QTY_RE.test(f.qty.trim()) || Number(f.qty) <= 0) return "qty";
  if (!f.unit.trim() || f.unit.trim().length > 20) return "unit";
  if (f.scrap.trim() && (!SCRAP_RE.test(f.scrap.trim()) || Number(f.scrap) > 100)) return "scrap";
  return null;
}

/** جسم POST /engineering/product-versions/:id/components. المصدر واحد بس (صنف أو منتج فرعي). */
export function componentPayload(f: ComponentForm) {
  const group = f.alternateGroup.trim();
  const notes = f.notes.trim();
  return {
    lineNo: f.lineNo,
    componentType: f.componentType,
    ...(isSubAssembly(f.componentType) ? { subAssemblyProductId: Number(f.subProductId) } : { foundationItemId: Number(f.itemId) }),
    qty: f.qty.trim(),
    unit: f.unit.trim(),
    scrapFactorPct: f.scrap.trim() || "0",
    isAlternate: f.componentType === "substitute",
    ...(group ? { alternateGroup: group } : {}),
    ...(notes ? { notes } : {}),
  };
}

export interface OperationForm {
  operationNo: string;
  name: string;
  workCenterId: string;
  machineId: string;
  setupMinutes: string;
  runMinutes: string;
  workers: string;
  qualityPoint: boolean;
  safety: string;
}
export type OperationError = "operationNo" | "name" | "setup" | "run" | "workers" | null;

export function operationError(f: OperationForm, taken: readonly number[] = []): OperationError {
  if (!/^[1-9]\d{0,5}$/.test(f.operationNo.trim()) || taken.includes(Number(f.operationNo))) return "operationNo";
  if (!f.name.trim() || f.name.trim().length > 180) return "name";
  if (f.setupMinutes.trim() && !/^\d{1,5}$/.test(f.setupMinutes.trim())) return "setup";
  if (f.runMinutes.trim() && !/^\d{1,8}(\.\d{1,4})?$/.test(f.runMinutes.trim())) return "run";
  if (f.workers.trim() && !/^[1-9]\d{0,3}$/.test(f.workers.trim())) return "workers";
  return null;
}

export function operationPayload(f: OperationForm) {
  const safety = f.safety.trim();
  return {
    operationNo: Number(f.operationNo.trim()),
    name: f.name.trim(),
    ...(f.workCenterId ? { workCenterId: Number(f.workCenterId) } : {}),
    ...(f.machineId ? { machineId: Number(f.machineId) } : {}),
    setupMinutes: f.setupMinutes.trim() ? Number(f.setupMinutes) : 0,
    runMinutesPerUnit: f.runMinutes.trim() || "0",
    workersRequired: f.workers.trim() ? Number(f.workers) : 1,
    qualityPoint: f.qualityPoint,
    ...(safety ? { safetyInstructions: safety } : {}),
  };
}

/** الماكينات اللي تخص مركز العمل المختار (أو كلها لو مفيش مركز). */
export const machinesFor = <M extends { workCenterId: number | null }>(machines: readonly M[], workCenterId: string): M[] =>
  workCenterId ? machines.filter((m) => String(m.workCenterId) === workCenterId) : [...machines];

/** إجمالي دقائق التشغيل لوحدة واحدة (تجهيز لا يتحسب: بيتوزّع على الدفعة). */
export const routingRunTotal = (ops: readonly { runMinutesPerUnit: string }[]) => Math.round(ops.reduce((s, o) => s + (Number(o.runMinutesPerUnit) || 0), 0) * 10000) / 10000;

export interface ProductForm { code: string; name: string; productType: string; baseUnit: string; description: string }
export type ProductError = "code" | "name" | "unit" | null;
export function productError(f: ProductForm): ProductError {
  if (!f.code.trim() || f.code.trim().length > 80) return "code";
  if (!f.name.trim() || f.name.trim().length > 180) return "name";
  if (!f.baseUnit.trim() || f.baseUnit.trim().length > 30) return "unit";
  return null;
}
export function productPayload(f: ProductForm) {
  const d = f.description.trim();
  return { code: f.code.trim(), name: f.name.trim(), productType: f.productType, baseUnit: f.baseUnit.trim(), ...(d ? { description: d } : {}) };
}

export const versionError = (version: string): "version" | null => (version.trim() && version.trim().length <= 40 ? null : "version");
export function versionPayload(version: string, effectiveFrom: string, changeReason: string) {
  const reason = changeReason.trim();
  return { version: version.trim(), ...(effectiveFrom ? { effectiveFrom } : {}), ...(reason ? { changeReason: reason } : {}), bomSnapshot: [], routingSnapshot: [], specifications: {} };
}

export interface ChangeForm { productId: string; versionId: string; title: string; reason: string; impact: string }
export type ChangeError = "product" | "title" | "reason" | null;
export function changeError(f: ChangeForm): ChangeError {
  if (!f.productId) return "product";
  if (!f.title.trim() || f.title.trim().length > 180) return "title";
  if (!f.reason.trim() || f.reason.trim().length > 2000) return "reason";
  return null;
}
export function changePayload(f: ChangeForm) {
  const impact = f.impact.trim();
  return { productId: Number(f.productId), ...(f.versionId ? { productVersionId: Number(f.versionId) } : {}), title: f.title.trim(), reason: f.reason.trim(), ...(impact ? { impactSummary: impact } : {}) };
}

export interface ChangeLike { status: string; requestedBy: number | null }
/** البت في طلب التغيير: دور اعتماد + الطلب مفتوح + مش صاحبه (فصل المهام، نفس السيرفر). */
export function canDecideChange(role: string, userId: number | undefined, c: ChangeLike): boolean {
  return canApproveEngineering(role) && c.status === "open" && !(userId !== undefined && c.requestedBy === userId);
}
/** سبب منع البت لو الدور مسموح لكن الطلب نفسه ممنوع. */
export function decideBlockReason(role: string, userId: number | undefined, c: ChangeLike): "own" | "closed" | null {
  if (!canApproveEngineering(role)) return null;
  if (c.status !== "open") return "closed";
  if (userId !== undefined && c.requestedBy === userId) return "own";
  return null;
}
export const decisionReasonOk = (s: string) => s.trim().length >= 3 && s.trim().length <= 1000;
