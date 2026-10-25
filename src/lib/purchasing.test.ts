import { describe, expect, it } from "vitest";
import { PoError, allowedPoMoves, canEditPo, canReceiveIn, orderTotal, planReceipt } from "./purchasing";

describe("انتقالات أمر الشراء حسب الدور", () => {
  it("المشتري يرسل للاعتماد بس ومايعتمدش", () => {
    expect(allowedPoMoves("draft", "buyer")).toEqual(["pending_approval", "cancelled"]);
    expect(allowedPoMoves("pending_approval", "buyer")).toEqual([]);
  });
  it("مدير المشتريات والرئيس بيعتمدوا ويرفضوا ويلغوا", () => {
    expect(allowedPoMoves("draft", "purchasing_manager")).toEqual(["pending_approval", "approved", "cancelled"]);
    expect(allowedPoMoves("pending_approval", "chairman")).toEqual(["approved", "draft", "cancelled"]);
  });
  it("المعتمد يتبعت للمورد، والمستلم أو الملغي خلص", () => {
    expect(allowedPoMoves("approved", "buyer")).toEqual(["sent"]);
    expect(allowedPoMoves("approved", "chairman")).toEqual(["sent", "cancelled"]);
    expect(allowedPoMoves("received", "chairman")).toEqual([]);
    expect(allowedPoMoves("cancelled", "chairman")).toEqual([]);
  });
  it("التعديل للمسودة والاستلام للمعتمد وما بعده", () => {
    expect(canEditPo("draft")).toBe(true);
    expect(canEditPo("approved")).toBe(false);
    expect(canReceiveIn("approved")).toBe(true);
    expect(canReceiveIn("partially_received")).toBe(true);
    expect(canReceiveIn("pending_approval")).toBe(false);
  });
});

describe("إجمالي الأمر", () => {
  it("بيجمع كمية × سعر ويقرّب لقرشين", () => {
    expect(orderTotal([{ qty: "10", unitPrice: "2.5" }, { qty: "0.333", unitPrice: "3" }])).toBe(26);
    expect(orderTotal([])).toBe(0);
  });
});

describe("الاستلام", () => {
  const items = [
    { id: 1, qty: "100", receivedQty: "0" },
    { id: 2, qty: "5", receivedQty: "2" },
  ];
  it("استلام جزئي", () => {
    const r = planReceipt(items, [{ itemId: 1, qty: "40" }]);
    expect(r.status).toBe("partially_received");
    expect(r.next).toEqual([{ id: 1, receivedQty: "40" }, { id: 2, receivedQty: "2" }]);
  });
  it("استلام كل المتبقي ← received", () => {
    const r = planReceipt(items, [{ itemId: 1, qty: "100" }, { itemId: 2, qty: "3" }]);
    expect(r.status).toBe("received");
  });
  it("أكتر من المتبقي أو كمية غلط أو بند غريب بيترفض", () => {
    expect(() => planReceipt(items, [{ itemId: 2, qty: "4" }])).toThrowError(PoError);
    expect(() => planReceipt(items, [{ itemId: 1, qty: "0" }])).toThrowError(PoError);
    expect(() => planReceipt(items, [{ itemId: 1, qty: "1.2345" }])).toThrowError(PoError);
    expect(() => planReceipt(items, [{ itemId: 9, qty: "1" }])).toThrowError(PoError);
    expect(() => planReceipt(items, [])).toThrowError(PoError);
  });
  it("نفس البند مرتين في طلب واحد بيتجمع", () => {
    expect(() => planReceipt(items, [{ itemId: 2, qty: "2" }, { itemId: 2, qty: "2" }])).toThrowError(PoError);
  });
});
