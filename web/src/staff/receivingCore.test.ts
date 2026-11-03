import { describe, expect, it } from "vitest";
import { canInspect, checkDecisions, defaultDecisions, receiptStats, receiptTone, setAll, type Receipt, type ReceiptLine } from "./receivingCore";

const lines: ReceiptLine[] = [
  { id: 1, description: "رصاص", unit: "kg", qtyReceived: "10.000", qtyAccepted: null, qtyRejected: null, rejectReason: null },
  { id: 2, description: "حمض", unit: "لتر", qtyReceived: "4.000", qtyAccepted: null, qtyRejected: null, rejectReason: null },
];

describe("receivingCore", () => {
  it("الفاحص: مراقب الخامات والرئيس بس", () => {
    expect(canInspect("raw_material_quality_controller")).toBe(true);
    expect(canInspect("warehouse_manager")).toBe(false);
    expect(canInspect(undefined)).toBe(false);
  });
  it("الافتراضي قبول الكل وبيعدّي", () => {
    const c = checkDecisions(lines, defaultDecisions(lines));
    expect(c.ok).toBe(true);
    expect(c.acceptedTotal).toBe(14);
    expect(c.payload).toEqual([{ lineId: 1, acceptedQty: "10" }, { lineId: 2, acceptedQty: "4" }]);
  });
  it("الرفض من غير سبب خطأ، ومعاه سبب بيعدّي ويحسب المرفوض", () => {
    const d = { ...defaultDecisions(lines), 1: { accepted: "7.5", reason: "" } };
    expect(checkDecisions(lines, d).errors).toEqual({ 1: "reason" });
    const ok = checkDecisions(lines, { ...d, 1: { accepted: "7.5", reason: "عبوات تالفة" } });
    expect(ok.ok).toBe(true);
    expect(ok.rejectedTotal).toBe(2.5);
    expect(ok.payload[0]).toEqual({ lineId: 1, acceptedQty: "7.5", rejectReason: "عبوات تالفة" });
  });
  it("مقبول أكبر من المستلم أو رقم غلط، والأرقام العربية بتتقبل", () => {
    expect(checkDecisions(lines, { ...defaultDecisions(lines), 2: { accepted: "5", reason: "" } }).errors).toEqual({ 2: "over" });
    expect(checkDecisions(lines, { ...defaultDecisions(lines), 2: { accepted: "abc", reason: "" } }).errors).toEqual({ 2: "qty" });
    expect(checkDecisions(lines, { ...defaultDecisions(lines), 2: { accepted: "٣٫٥", reason: "تالف" } }).ok).toBe(true);
  });
  it("ارفض الكل بيحتاج أسباب، واقبل الكل بيرجّع الأصل", () => {
    const rej = setAll(lines, "reject", defaultDecisions(lines));
    expect(Object.keys(checkDecisions(lines, rej).errors).length).toBe(2);
    expect(checkDecisions(lines, setAll(lines, "accept", rej)).ok).toBe(true);
  });
  it("الإحصائيات والألوان", () => {
    const r = (status: string) => ({ status }) as Receipt;
    expect(receiptStats([r("pending_inspection"), r("accepted"), r("rejected"), r("accepted")])).toEqual({ pending: 1, accepted: 2, partial: 0, rejected: 1 });
    expect(receiptTone("rejected")).toBe("danger");
  });
});
