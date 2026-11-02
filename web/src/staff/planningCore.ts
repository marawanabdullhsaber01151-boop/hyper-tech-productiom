/**
 * منطق شاشة التخطيط (خطوة 34): فرد الوصفات لاحتياجات خامات، حفظ سيناريو، اعتماد، تسليم، طلبات شراء.
 * بدون واجهة عشان يتختبر لوحده. لازم يتطابق مع src/routes/planning.ts (السيرفر هو الحَكَم).
 */

/** نفس planningRoles في السيرفر: مين يخطّط ويشوف. */
export const PLANNING_ROLES = ["chairman", "production_manager", "production_controller", "warehouse_manager"] as const;
/** مين يعتمد ويسلّم السيناريو. */
export const PLANNING_APPROVAL_ROLES = ["chairman", "production_manager"] as const;

export const canPlan = (role: string) => (PLANNING_ROLES as readonly string[]).includes(role);
export const canApprovePlan = (role: string) => (PLANNING_APPROVAL_ROLES as readonly string[]).includes(role);

/* ───────────── أنواع (مرآة رد السيرفر) ───────────── */

export interface DemandSource { recipeId: number; productName: string; lineNo: number; producedQty: string; perBatchQty: string; outputQty: string; contribution: string }
export interface PreviewDemand {
  inventoryItemId: number;
  code: string | null;
  name: string;
  unit: string;
  grossQty: string;
  requiredBy: string;
  sources: DemandSource[];
  stock: { onHand: string; reserved: string; quarantine: string };
  openSupply: { purchaseOrders: string; requisitions: string; total: string };
  result: { freeAvailableQty: string; netQty: string; status: "covered" | "shortage"; shortageCode: string; explanation: string };
}
export interface PreviewBlocker { code: string; recipeId: number; productName: string | null; materialName: string | null; message: string }
export interface Preview { demands: PreviewDemand[]; blockers: PreviewBlocker[]; summary: { demandCount: number; shortageCount: number; blockerCount: number } }

export interface RunSummary { demandCount: number; shortageCount: number; overloadedCount: number }
export interface RunRow { id: number; runKey: string; scenarioCode: string; status: string; horizonStart: string; horizonEnd: string; createdAt: string; summary: RunSummary }
export interface RunInput { id: number; inventoryItemId: number; grossQty: string; requiredBy: string; sourceType: string; snapshot: { item?: { name?: string; code?: string | null; unit?: string | null }; sources?: DemandSource[]; openSupply?: { purchaseOrders: string; requisitions: string; total: string }; stock?: { onHand: string; reserved: string; quarantine: string } } }
export interface RunShortage { id: number; materialRequirementId: number; code: string; message: string; explanation: string; recommendedAction: string }
export interface RunCapacity { id: number; loadDate: string; requiredMinutes: number; availableMinutes: number; overloadMinutes: number; status: string; explanation: string }
export interface RunRequisition { id: number; number: string; materialRequirementId: number; requestedQty: string; status: string }
export interface RunDetail extends RunRow { inputs: RunInput[]; shortageMessages: RunShortage[]; capacityLoads: RunCapacity[]; requisitions: RunRequisition[] }

/* ───────────── سطور السيناريو ───────────── */

export interface LineDraft { key: number; recipeId: string; qty: string; requiredBy: string }
export type LineError = "recipe" | "qty" | "date" | null;

/** تاريخ اليوم محليًا بصيغة YYYY-MM-DD (مش UTC، عشان بعد منتصف الليل ما يتحسبش أمس). */
export function todayISO(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function addDaysISO(iso: string, days: number): string {
  const [y = 1970, m = 1, d = 1] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return todayISO(dt);
}

export const emptyLine = (key: number, today: string): LineDraft => ({ key, recipeId: "", qty: "", requiredBy: addDaysISO(today, 14) });

/** أرقام عربية-هندية (U+0660..0669) أو فاصلة عربية (U+066B) → لاتينية. */
export function normalizeQty(s: string): string {
  return s.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[٫,]/g, ".");
}

const QTY = /^\d{1,9}(\.\d{1,3})?$/;
export function lineError(l: LineDraft, today: string): LineError {
  if (!l.recipeId) return "recipe";
  const q = normalizeQty(l.qty);
  if (!QTY.test(q) || Number(q) <= 0) return "qty";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(l.requiredBy) || l.requiredBy < today) return "date";
  return null;
}

export const linesValid = (lines: readonly LineDraft[], today: string) => lines.length > 0 && lines.every((l) => lineError(l, today) === null);

/** نفس الوصفة في سطرين: نبّه (مش خطأ، ممكن تواريخ مختلفة). */
export const duplicateRecipes = (lines: readonly LineDraft[]) => {
  const seen = new Map<string, number>();
  for (const l of lines) if (l.recipeId) seen.set(l.recipeId, (seen.get(l.recipeId) ?? 0) + 1);
  return [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
};

export const explodePayload = (lines: readonly LineDraft[]) => ({
  lines: lines.map((l) => ({ bomRecipeId: Number(l.recipeId), qty: normalizeQty(l.qty), requiredBy: l.requiredBy })),
});

/* ───────────── المعاينة ← سيناريو ───────────── */

/** ينفع نحفظ لما مفيش blockers وفي احتياج واحد على الأقل (مفيش تخمين لمكوّن مش مربوط). */
export const canSavePreview = (p: Preview | null): boolean => Boolean(p) && p!.blockers.length === 0 && p!.demands.length > 0;

export const SOURCE_TYPES = ["manual", "forecast"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export function runPayload(preview: Preview, opts: { scenarioCode: string; sourceType: SourceType; today: string }) {
  const horizonEnd = preview.demands.reduce((m, d) => (d.requiredBy > m ? d.requiredBy : m), opts.today);
  return {
    scenarioCode: opts.scenarioCode.trim() || "baseline",
    horizonStart: opts.today,
    horizonEnd,
    assumptions: { source: "bom_explode" },
    demands: preview.demands.map((d) => ({
      sourceType: opts.sourceType,
      sourceId: null,
      inventoryItemId: d.inventoryItemId,
      grossQty: d.grossQty,
      requiredBy: d.requiredBy,
      openSupplyQty: d.openSupply.total,
      leadDays: 0,
      snapshot: { sources: d.sources, openSupply: d.openSupply, stock: d.stock },
    })),
    capacityLoads: [],
  };
}

/** سطر «ليه؟»: الكمية المطلوبة = كمية الدفعة × المنتج ÷ ناتج الدفعة. */
export const formulaParts = (s: DemandSource) => ({ produced: s.producedQty, perBatch: s.perBatchQty, output: s.outputQty, result: s.contribution, product: s.productName });

/* ───────────── السيناريوهات المحفوظة ───────────── */

export const RUN_STATUSES = ["draft", "approved", "released"] as const;
export type RunAction = "approve" | "release" | "requisitions";

export const requisitionByRequirement = (run: Pick<RunDetail, "requisitions">) => new Map(run.requisitions.map((r) => [r.materialRequirementId, r]));

/** عجز لسه ما اتعملهوش طلب شراء. */
export const pendingShortages = (run: Pick<RunDetail, "shortageMessages" | "requisitions">) => {
  const done = requisitionByRequirement(run);
  return run.shortageMessages.filter((s) => !done.has(s.materialRequirementId));
};

/** الإجراءات المتاحة على سيناريو حسب الدور والحالة (نفس قواعد السيرفر). */
export function runActions(role: string, run: Pick<RunDetail, "status" | "shortageMessages" | "requisitions">): RunAction[] {
  const out: RunAction[] = [];
  if (canApprovePlan(role) && run.status === "draft") out.push("approve");
  if (canApprovePlan(role) && run.status === "approved") out.push("release");
  if (canPlan(role) && (run.status === "approved" || run.status === "released") && pendingShortages(run).length > 0) out.push("requisitions");
  return out;
}

/** سبب مقفول الطلبات: لازم السيناريو يتعتمد الأول. */
export const requisitionsBlockedReason = (run: Pick<RunDetail, "status" | "shortageMessages">): "notApproved" | "noShortage" | null =>
  run.shortageMessages.length === 0 ? "noShortage" : run.status === "draft" ? "notApproved" : null;
