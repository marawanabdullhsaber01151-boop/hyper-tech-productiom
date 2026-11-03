/** @format */
/** فحص استلام الخامات (منطق نقي من غير قاعدة بيانات): الأدوار، الحالات، قرار الفحص. السيرفر هو المرجع. */
import { PO_READ_ROLES, PoError } from "./purchasing";

export const RECEIPT_STATUSES = ["pending_inspection", "accepted", "partially_accepted", "rejected"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];
export const isReceiptStatus = (s: string): s is ReceiptStatus => (RECEIPT_STATUSES as readonly string[]).includes(s);

/** مين يفحص: مراقب جودة الخامات ورئيس المجلس. */
export const INSPECT_ROLES = ["chairman", "raw_material_quality_controller"] as const;
export const canInspect = (role: string) => (INSPECT_ROLES as readonly string[]).includes(role);
/** مين يشوف الإيصالات (من غير أسعار أبدًا). */
export const RECEIPT_READ_ROLES = [...PO_READ_ROLES, "raw_material_quality_controller"] as const;

/** الفاحص مايفحصش استلام عمله بنفسه (فصل المهام)، ورئيس المجلس مستثنى. */
export const violatesSeparation = (role: string, inspectorId: number, receiverId: number) => role !== "chairman" && inspectorId === receiverId;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const QTY = /^\d+(\.\d{1,3})?$/;

export interface PendingLine {
  id: number;
  qtyReceived: string;
}
export interface Decision {
  lineId: number;
  acceptedQty: string;
  rejectReason?: string | null;
}
export interface InspectionPlan {
  lines: Array<{ id: number; accepted: number; rejected: number; rejectReason: string | null }>;
  acceptedTotal: number;
  rejectedTotal: number;
  status: Exclude<ReceiptStatus, "pending_inspection">;
}

/** كل بند لازم ياخد قرار، المقبول بين صفر والمستلم، وأي مرفوض لازم سبب (3 حروف على الأقل). */
export function planInspection(lines: PendingLine[], decisions: Decision[]): InspectionPlan {
  const by = new Map<number, Decision>();
  for (const d of decisions) {
    if (by.has(d.lineId)) throw new PoError("بند مكرر في قرار الفحص");
    by.set(d.lineId, d);
  }
  if (by.size !== lines.length || lines.some((l) => !by.has(l.id))) throw new PoError("لازم قرار لكل بنود الإيصال");
  const out = lines.map((l) => {
    const d = by.get(l.id)!;
    if (!QTY.test(String(d.acceptedQty))) throw new PoError("الكمية المقبولة لازم تكون رقم (لحد 3 أرقام عشرية)");
    const received = Number(l.qtyReceived);
    const accepted = r3(Number(d.acceptedQty));
    if (accepted > received + 1e-9) throw new PoError("الكمية المقبولة أكبر من المستلمة");
    const rejected = r3(received - accepted);
    const reason = (d.rejectReason ?? "").trim();
    if (rejected > 0 && reason.length < 3) throw new PoError("اكتب سبب الرفض (3 حروف على الأقل) لكل بند فيه مرفوض");
    return { id: l.id, accepted, rejected, rejectReason: rejected > 0 ? reason : null };
  });
  const acceptedTotal = r3(out.reduce((s, l) => s + l.accepted, 0));
  const rejectedTotal = r3(out.reduce((s, l) => s + l.rejected, 0));
  const status = rejectedTotal === 0 ? "accepted" : acceptedTotal === 0 ? "rejected" : "partially_accepted";
  return { lines: out, acceptedTotal, rejectedTotal, status };
}

/** المتبقي القابل للاستلام لبند = المطلوب − المقبول − اللي مستني فحص. */
export const receivableRemaining = (qty: string, accepted: string, pending: number) => Math.max(0, r3(Number(qty) - Number(accepted) - pending));
