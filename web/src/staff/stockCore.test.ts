import { describe, expect, it } from "vitest";
import { adjustmentFor, buildMovementRows, canManageStock, inDateRange, moveError, movementTotals, stockValue, totalValue, type Movement } from "./stockCore";

const mv = (id: number, item: number, type: string, qty: string, at: string): Movement => ({ id, inventoryItemId: item, movementType: type, qty, referenceType: "adjustment", referenceId: item, unitPrice: null, notes: null, createdAt: at });

describe("buildMovementRows", () => {
  it("رصيد قبل/بعد لكل حركة بالرجوع من الكمية الحالية", () => {
    // الكمية الحالية 70: بدأ 50، +100 (150)، -80 (70)
    const rows = buildMovementRows([{ id: 1, qty: "70" }], [mv(1, 1, "in", "100", "2026-10-01T08:00:00Z"), mv(2, 1, "out", "80", "2026-10-02T08:00:00Z")]);
    expect(rows.map((r) => [r.id, r.balanceBefore, r.balanceAfter])).toEqual([[2, 150, 70], [1, 50, 150]]);
  });
  it("كل صنف رصيده لوحده، والترتيب بالأحدث", () => {
    const rows = buildMovementRows(
      [{ id: 1, qty: "10" }, { id: 2, qty: "5" }],
      [mv(1, 1, "in", "10", "2026-10-01T08:00:00Z"), mv(2, 2, "in", "5", "2026-10-03T08:00:00Z")],
    );
    expect(rows.map((r) => r.id)).toEqual([2, 1]);
    expect(rows.map((r) => [r.balanceBefore, r.balanceAfter])).toEqual([[0, 5], [0, 10]]);
  });
  it("كسور عشرية بدون أخطاء عائمة", () => {
    const rows = buildMovementRows([{ id: 1, qty: "0.3" }], [mv(1, 1, "in", "0.1", "2026-10-01T08:00:00Z"), mv(2, 1, "in", "0.2", "2026-10-02T08:00:00Z")]);
    expect(rows.map((r) => r.balanceBefore)).toEqual([0.1, 0]);
  });
  it("صنف مش موجود أو من غير حركات", () => {
    expect(buildMovementRows([], [])).toEqual([]);
  });
});

describe("الجرد", () => {
  it("زيادة ونقص وصفر وقيم غلط", () => {
    expect(adjustmentFor(10, "15")).toEqual({ type: "in", qty: "5", delta: 5 });
    expect(adjustmentFor(10, "4.5")).toEqual({ type: "out", qty: "5.5", delta: -5.5 });
    expect(adjustmentFor(10, "10")).toBeNull();
    expect(adjustmentFor(10, "")).toBeNull();
    expect(adjustmentFor(10, "-3")).toBeNull();
    expect(adjustmentFor(10, "1.2345")).toBeNull();
    expect(adjustmentFor(10, "١٥")).toEqual({ type: "in", qty: "5", delta: 5 });
  });
});

describe("moveError", () => {
  it("بيتحقق من الكمية والرصيد والسبب", () => {
    expect(moveError("in", "0", 5, "x")).toBe("qty");
    expect(moveError("out", "6", 5, "x")).toBe("insufficient");
    expect(moveError("out", "5", 5, "x")).toBeNull();
    expect(moveError("in", "3", 5, "  ")).toBe("reason");
    expect(moveError("in", "3", 5, "توريد")).toBeNull();
  });
});

describe("القيمة والإجماليات", () => {
  it("قيمة الصنف null لو السعر مش واصل", () => {
    expect(stockValue({ qty: "4", unitPrice: "2.5" })).toBe(10);
    expect(stockValue({ qty: "4" })).toBeNull();
    expect(totalValue([{ qty: "4" }])).toBeNull();
    expect(totalValue([{ qty: "4", unitPrice: "2.5" }, { qty: "1", unitPrice: "0.5" }])).toBe(10.5);
  });
  it("إجماليات الحركات", () => {
    expect(movementTotals([{ movementType: "in", qty: "5" }, { movementType: "out", qty: "2.5" }, { movementType: "in", qty: "1" }])).toEqual({ count: 3, inQty: 6, outQty: 2.5 });
  });
  it("نطاق التاريخ", () => {
    expect(inDateRange("2026-10-05T10:00:00Z", "2026-10-01", "2026-10-05")).toBe(true);
    expect(inDateRange("2026-10-06T10:00:00Z", "2026-10-01", "2026-10-05")).toBe(false);
    expect(inDateRange("2026-10-06T10:00:00Z", "", "")).toBe(true);
  });
  it("صلاحية الإدارة", () => {
    expect(canManageStock("storekeeper")).toBe(true);
    expect(canManageStock("buyer")).toBe(false);
    expect(canManageStock(undefined)).toBe(false);
  });
});
