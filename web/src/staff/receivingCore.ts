import { normNum } from "./salesCore";

/** منطق فحص الاستلام النقي. السيرفر هو الحَكَم (src/lib/receiving.ts). */
export const INSPECT_ROLES = ["chairman", "raw_material_quality_controller"] as const;
export const canInspect = (role: string | undefined) => !!role && (INSPECT_ROLES as readonly string[]).includes(role);

export const RECEIPT_STATUSES = ["pending_inspection", "accepted", "partially_accepted", "rejected"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];
export const receiptTone = (s: string): "warn" | "success" | "info" | "danger" | "neutral" =>
  s === "pending_inspection" ? "warn" : s === "accepted" ? "success" : s === "partially_accepted" ? "info" : s === "rejected" ? "danger" : "neutral";

export interface ReceiptLine { id: number; description: string; unit: string | null; qtyReceived: string; qtyAccepted: string | null; qtyRejected: string | null; rejectReason: string | null }
export interface Receipt {
  id: number; receiptNumber: string; poId: number; poNumber: string; supplierName: string | null; status: string; notes: string | null;
  receivedByName: string | null; receivedAt: string; inspectedByName: string | null; inspectedAt: string | null; inspectionNotes: string | null; lines: ReceiptLine[];
}

export const receiptStats = (rows: readonly Receipt[]) => ({
  pending: rows.filter((r) => r.status === "pending_inspection").length,
  accepted: rows.filter((r) => r.status === "accepted").length,
  partial: rows.filter((r) => r.status === "partially_accepted").length,
  rejected: rows.filter((r) => r.status === "rejected").length,
});

export interface DecisionInput { accepted: string; reason: string }
export const defaultDecisions = (lines: readonly ReceiptLine[]): Record<number, DecisionInput> =>
  Object.fromEntries(lines.map((l) => [l.id, { accepted: String(Number(l.qtyReceived)), reason: "" }]));
/** قبول/رفض الكل بضغطة. */
export const setAll = (lines: readonly ReceiptLine[], mode: "accept" | "reject", old: Record<number, DecisionInput>): Record<number, DecisionInput> =>
  Object.fromEntries(lines.map((l) => [l.id, { accepted: mode === "accept" ? String(Number(l.qtyReceived)) : "0", reason: old[l.id]?.reason ?? "" }]));

export type DecisionError = "qty" | "over" | "reason";
const QTY = /^\d+(\.\d{1,3})?$/;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
export interface DecisionCheck {
  errors: Record<number, DecisionError>;
  ok: boolean;
  payload: Array<{ lineId: number; acceptedQty: string; rejectReason?: string }>;
  acceptedTotal: number;
  rejectedTotal: number;
}
export function checkDecisions(lines: readonly ReceiptLine[], input: Record<number, DecisionInput>): DecisionCheck {
  const errors: Record<number, DecisionError> = {};
  const payload: DecisionCheck["payload"] = [];
  let acceptedTotal = 0;
  let rejectedTotal = 0;
  for (const l of lines) {
    const d = input[l.id] ?? { accepted: "", reason: "" };
    const raw = normNum(d.accepted);
    if (!QTY.test(raw)) { errors[l.id] = "qty"; continue; }
    const received = Number(l.qtyReceived);
    const accepted = r3(Number(raw));
    if (accepted > received + 1e-9) { errors[l.id] = "over"; continue; }
    const rejected = r3(received - accepted);
    const reason = d.reason.trim();
    if (rejected > 0 && reason.length < 3) { errors[l.id] = "reason"; continue; }
    acceptedTotal = r3(acceptedTotal + accepted);
    rejectedTotal = r3(rejectedTotal + rejected);
    payload.push({ lineId: l.id, acceptedQty: String(accepted), ...(rejected > 0 ? { rejectReason: reason } : {}) });
  }
  return { errors, ok: Object.keys(errors).length === 0, payload, acceptedTotal, rejectedTotal };
}
export const rejectedOf = (l: Pick<ReceiptLine, "qtyReceived">, d: DecisionInput | undefined) => {
  const raw = normNum(d?.accepted ?? "");
  return QTY.test(raw) ? Math.max(0, r3(Number(l.qtyReceived) - Number(raw))) : 0;
};
