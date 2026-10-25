/** منطق أوامر الشراء النقي (من غير قاعدة بيانات): الحالات، الانتقالات حسب الدور، الإجمالي، الاستلام. */

export const PO_STATUSES = ["draft", "pending_approval", "approved", "sent", "partially_received", "received", "cancelled"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];
export const isPoStatus = (s: string): s is PoStatus => (PO_STATUSES as readonly string[]).includes(s);

/** اعتماد أمر الشراء لمدير المشتريات ورئيس المجلس بس (المشتري ما بيعتمدش أمره بنفسه). */
export const PO_APPROVER_ROLES = ["chairman", "purchasing_manager"] as const;
export const isPoApprover = (role: string) => (PO_APPROVER_ROLES as readonly string[]).includes(role);

/** مين يقرا أوامر الشراء (أمين المخزن بيقرا عشان يستلم). الأسعار والإجمالي للأدوار المالية بس. */
export const PO_READ_ROLES = ["chairman", "executive_manager", "purchasing_manager", "buyer", "warehouse_manager", "storekeeper"] as const;
export const PO_PRICE_ROLES = ["chairman", "executive_manager", "purchasing_manager", "buyer"] as const;
export const canSeePoPrices = (role: string) => (PO_PRICE_ROLES as readonly string[]).includes(role);

/** انتقالات الحالة اليدوية (الاستلام بيغيّر الحالة تلقائيًا ومش من هنا). */
const MANUAL: Record<PoStatus, readonly PoStatus[]> = {
  draft: ["pending_approval", "approved", "cancelled"],
  pending_approval: ["approved", "draft", "cancelled"],
  approved: ["sent", "cancelled"],
  sent: ["cancelled"],
  partially_received: [],
  received: [],
  cancelled: [],
};

export function allowedPoMoves(status: PoStatus, role: string): PoStatus[] {
  return MANUAL[status].filter((to) => {
    if (to === "approved") return isPoApprover(role);
    // الإلغاء بعد الاعتماد (أو من مرحلة الاعتماد) للمعتمدين بس؛ المسودة يلغيها صاحب الصلاحية
    if (to === "cancelled" && status !== "draft") return isPoApprover(role);
    // الرفض (رجوع للمسودة) قرار المعتمد
    if (to === "draft") return isPoApprover(role);
    return true;
  });
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export interface LineIn {
  qty: string | number;
  unitPrice: string | number;
}
export function orderTotal(lines: LineIn[]): number {
  return r2(lines.reduce((s, l) => s + Number(l.qty) * Number(l.unitPrice), 0));
}

export interface ReceiptItem {
  id: number;
  qty: string;
  receivedQty: string;
}
export interface ReceiptLine {
  itemId: number;
  qty: string;
}
export class PoError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** بيتحقق من الاستلام (كمية موجبة، البند موجود، مش أكتر من المتبقي) وبيرجّع الحالة الجديدة. */
export function planReceipt(items: ReceiptItem[], lines: ReceiptLine[]): { next: Array<{ id: number; receivedQty: string }>; status: "partially_received" | "received" } {
  if (!lines.length) throw new PoError("اختار بند واحد على الأقل للاستلام");
  const by = new Map(items.map((i) => [i.id, i]));
  const add = new Map<number, number>();
  for (const l of lines) {
    const it = by.get(l.itemId);
    if (!it) throw new PoError("بند الاستلام مش موجود في الأمر", 404);
    const q = Number(l.qty);
    if (!Number.isFinite(q) || q <= 0 || !/^\d+(\.\d{1,3})?$/.test(String(l.qty))) throw new PoError("كمية الاستلام لازم تكون أكبر من صفر (لحد 3 أرقام عشرية)");
    add.set(l.itemId, r3((add.get(l.itemId) ?? 0) + q));
  }
  const next = items.map((i) => {
    const got = Number(i.receivedQty) + (add.get(i.id) ?? 0);
    if (got > Number(i.qty) + 1e-9) throw new PoError("كمية الاستلام أكبر من المتبقي في الأمر");
    return { id: i.id, receivedQty: String(r3(got)) };
  });
  const done = next.every((n) => Number(n.receivedQty) >= Number(items.find((i) => i.id === n.id)!.qty) - 1e-9);
  return { next, status: done ? "received" : "partially_received" };
}

/** أمر الشراء ينفع يتستلم منه في الحالات دي. */
export const canReceiveIn = (status: PoStatus) => status === "approved" || status === "sent" || status === "partially_received";
/** التعديل على بنود الأمر مسموح للمسودة بس. */
export const canEditPo = (status: PoStatus) => status === "draft";
