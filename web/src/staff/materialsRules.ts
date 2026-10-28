/** قواعد قرار المخزن على خامات أمر الإنتاج. بدون واجهة، عشان تتختبر لوحدها. السيرفر هو الحَكَم الفعلي (src/lib/warehouseDecisionCore.ts). */

/** نفس MATERIALS_DECIDE_ROLES في السيرفر. */
export const MATERIALS_DECIDE_ROLES = ["warehouse_manager", "storekeeper", "operations_manager", "executive_manager", "chairman"] as const;
/** أدوار المخزن بتجهّز وتسلّم لمدير التشغيل، والباقي بيخصم من المخزن مباشرة (نفس الفرع في السيرفر). */
export const PREPARE_ONLY_ROLES = ["warehouse_manager", "storekeeper"] as const;

export interface CheckedMaterial {
  inventoryItemId: number;
  materialName: string;
  requestedQty: string;
  availableQty: string;
  unit: string;
  sufficient: boolean;
}
export type MaterialsMode = "approve" | "partial" | "reject";
export type MaterialsError = "reason" | "shortage" | "qtyBad" | "qtyOverReq" | "qtyOverAvail" | "allZero" | null;

const QTY_RE = /^\d+(\.\d{1,4})?$/;

/** الكمية المقترحة تلقائيًا: الأقل بين المطلوب والمتاح (بثلاث خانات عشرية). */
export const defaultQty = (m: CheckedMaterial) => Math.min(Number(m.requestedQty), Number(m.availableQty)).toFixed(3);

export const shortageOf = (m: CheckedMaterial) => Math.max(0, Number(m.requestedQty) - Number(m.availableQty));
export const shortMaterials = (list: CheckedMaterial[]) => list.filter((m) => !m.sufficient);

/** القرار الافتراضي: اعتماد كامل لو كل شيء متوفر، وإلا جزئي. */
export const defaultMode = (list: CheckedMaterial[]): MaterialsMode => (shortMaterials(list).length ? "partial" : "approve");

/** أول خطأ يمنع الإرسال (نفس ترتيب قواعد السيرفر). `badName` بيرجع اسم المادة صاحبة الخطأ. */
export function materialsError(input: { mode: MaterialsMode; comment: string; list: CheckedMaterial[]; qtys: Record<number, string> }): { code: MaterialsError; names: string[] } {
  const { mode, comment, list, qtys } = input;
  if (mode === "reject") return comment.trim().length < 3 ? { code: "reason", names: [] } : { code: null, names: [] };
  if (mode === "approve") {
    const short = shortMaterials(list);
    return short.length ? { code: "shortage", names: short.map((m) => m.materialName) } : { code: null, names: [] };
  }
  let anyPositive = false;
  for (const m of list) {
    const q = (qtys[m.inventoryItemId] ?? "").trim();
    if (!QTY_RE.test(q)) return { code: "qtyBad", names: [m.materialName] };
    const n = Number(q);
    if (n > Number(m.requestedQty)) return { code: "qtyOverReq", names: [m.materialName] };
    if (n > Number(m.availableQty)) return { code: "qtyOverAvail", names: [m.materialName] };
    if (n > 0) anyPositive = true;
  }
  return anyPositive || list.length === 0 ? { code: null, names: [] } : { code: "allZero", names: [] };
}

/** جسم الطلب للسيرفر. الاعتماد الكامل مفيهوش كميات (السيرفر بياخد المطلوب كله). */
export function decisionBody(input: { mode: MaterialsMode; comment: string; list: CheckedMaterial[]; qtys: Record<number, string> }) {
  const comment = input.comment.trim() || undefined;
  if (input.mode === "partial") {
    return { action: "partial" as const, comment, materialDecisions: input.list.map((m) => ({ materialName: m.materialName, inventoryItemId: m.inventoryItemId, approvedQty: (input.qtys[m.inventoryItemId] ?? "0").trim(), unit: m.unit })) };
  }
  return { action: input.mode, comment };
}
