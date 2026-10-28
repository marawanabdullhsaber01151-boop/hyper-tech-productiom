/** @format */
// قواعد قرار المخزن على خامات أمر الإنتاج (اعتماد / جزئي / رفض) بدون قاعدة بيانات، عشان تتختبر لوحدها.

/** نفس الصلاحية الافتراضية productionWorkflow.warehouseAction. */
export const MATERIALS_DECIDE_ROLES = ["warehouse_manager", "storekeeper", "operations_manager", "executive_manager", "chairman"] as const;

export interface RequestedMaterial {
  inventoryItemId: number | null;
  materialName: string;
  requestedQty: string;
}
export interface MaterialDecision {
  inventoryItemId?: number | null;
  materialName: string;
  approvedQty: string;
}
export type MaterialsDecisionCheck =
  | { ok: true }
  | {
      ok: false;
      code: "REJECT_NEEDS_REASON" | "SHORTAGE_BLOCKS_APPROVE" | "PARTIAL_NEEDS_DECISIONS" | "PARTIAL_QTY_INVALID" | "PARTIAL_OVER_REQUESTED" | "PARTIAL_OVER_AVAILABLE" | "PARTIAL_ALL_ZERO";
      message: string;
    };

const QTY_RE = /^\d+(\.\d{1,4})?$/;

/**
 * - الرفض لازم له سبب مكتوب (3 حروف على الأقل).
 * - الاعتماد الكامل مرفوض لو أي مادة متاحها أقل من المطلوب (والرسالة بتسمّي المواد الناقصة).
 * - الجزئي لازم يحدد كمية لكل مادة مرتبطة بالمخزون: رقم صحيح، مش أكبر من المطلوب ولا من المتاح،
 *   ولازم تبقى كمية واحدة على الأقل أكبر من صفر.
 */
export function checkMaterialsDecision(input: {
  action: "approve" | "partial" | "reject";
  comment?: string | null;
  requested: RequestedMaterial[];
  availableById: Record<number, number>;
  decisions?: MaterialDecision[];
}): MaterialsDecisionCheck {
  const comment = (input.comment ?? "").trim();
  const linked = input.requested.filter((m) => m.inventoryItemId !== null && m.inventoryItemId !== undefined);

  if (input.action === "reject") {
    if (comment.length < 3) return { ok: false, code: "REJECT_NEEDS_REASON", message: "اكتب سبب الرفض (3 حروف على الأقل)" };
    return { ok: true };
  }

  if (input.action === "approve") {
    const short = linked.filter((m) => (input.availableById[m.inventoryItemId as number] ?? 0) < Number(m.requestedQty));
    if (short.length) return { ok: false, code: "SHORTAGE_BLOCKS_APPROVE", message: `المتاح أقل من المطلوب في: ${short.map((m) => m.materialName).join("، ")}. اعتمد جزئيًا أو ارفض مع السبب.` };
    return { ok: true };
  }

  const decisions = input.decisions ?? [];
  if (!decisions.length) return { ok: false, code: "PARTIAL_NEEDS_DECISIONS", message: "حدّد الكمية المعتمدة لكل مادة" };
  let anyPositive = false;
  for (const m of linked) {
    const d = decisions.find((x) => x.inventoryItemId === m.inventoryItemId);
    if (!d) return { ok: false, code: "PARTIAL_NEEDS_DECISIONS", message: `حدّد الكمية المعتمدة لـ«${m.materialName}»` };
    const q = d.approvedQty.trim();
    if (!QTY_RE.test(q)) return { ok: false, code: "PARTIAL_QTY_INVALID", message: `كمية «${m.materialName}» لازم تكون رقمًا صحيحًا` };
    const n = Number(q);
    if (n > Number(m.requestedQty)) return { ok: false, code: "PARTIAL_OVER_REQUESTED", message: `كمية «${m.materialName}» أكبر من المطلوب (${m.requestedQty})` };
    if (n > (input.availableById[m.inventoryItemId as number] ?? 0)) return { ok: false, code: "PARTIAL_OVER_AVAILABLE", message: `كمية «${m.materialName}» أكبر من المتاح بالمخزن` };
    if (n > 0) anyPositive = true;
  }
  if (!anyPositive) return { ok: false, code: "PARTIAL_ALL_ZERO", message: "الموافقة الجزئية لازم تعتمد كمية واحدة على الأقل. لو مفيش خامات متاحة اعمل رفض مع السبب." };
  return { ok: true };
}
