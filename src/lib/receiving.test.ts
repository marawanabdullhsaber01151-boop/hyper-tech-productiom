/** @format */
import { describe, expect, it } from "vitest";
import { PoError } from "./purchasing";
import { canInspect, planInspection, receivableRemaining, violatesSeparation } from "./receiving";

const lines = [{ id: 1, qtyReceived: "10.000" }, { id: 2, qtyReceived: "4.000" }];

describe("planInspection", () => {
  it("قبول كامل", () => {
    const p = planInspection(lines, [{ lineId: 1, acceptedQty: "10" }, { lineId: 2, acceptedQty: "4" }]);
    expect(p.status).toBe("accepted");
    expect(p.acceptedTotal).toBe(14);
    expect(p.rejectedTotal).toBe(0);
  });
  it("قبول جزئي بسبب رفض", () => {
    const p = planInspection(lines, [{ lineId: 1, acceptedQty: "7.5", rejectReason: "عبوات تالفة" }, { lineId: 2, acceptedQty: "4" }]);
    expect(p.status).toBe("partially_accepted");
    expect(p.lines[0]).toMatchObject({ accepted: 7.5, rejected: 2.5, rejectReason: "عبوات تالفة" });
    expect(p.lines[1]!.rejectReason).toBeNull();
  });
  it("رفض كامل", () => {
    const p = planInspection(lines, [{ lineId: 1, acceptedQty: "0", rejectReason: "مخالف للمواصفات" }, { lineId: 2, acceptedQty: "0", rejectReason: "منتهي الصلاحية" }]);
    expect(p.status).toBe("rejected");
    expect(p.acceptedTotal).toBe(0);
  });
  it("بيرفض: رفض من غير سبب، مقبول أكبر من المستلم، بند ناقص أو مكرر، رقم غلط", () => {
    expect(() => planInspection(lines, [{ lineId: 1, acceptedQty: "5" }, { lineId: 2, acceptedQty: "4" }])).toThrow(PoError);
    expect(() => planInspection(lines, [{ lineId: 1, acceptedQty: "11" }, { lineId: 2, acceptedQty: "4" }])).toThrow(PoError);
    expect(() => planInspection(lines, [{ lineId: 1, acceptedQty: "10" }])).toThrow(PoError);
    expect(() => planInspection(lines, [{ lineId: 1, acceptedQty: "10" }, { lineId: 1, acceptedQty: "10" }])).toThrow(PoError);
    expect(() => planInspection(lines, [{ lineId: 1, acceptedQty: "-1" }, { lineId: 2, acceptedQty: "4" }])).toThrow(PoError);
    expect(() => planInspection(lines, [{ lineId: 1, acceptedQty: "10" }, { lineId: 2, acceptedQty: "abc" }])).toThrow(PoError);
  });
  it("الكسور العشرية متدوّرة صح", () => {
    const p = planInspection([{ id: 1, qtyReceived: "0.3" }], [{ lineId: 1, acceptedQty: "0.1", rejectReason: "سبب" }]);
    expect(p.lines[0]!.rejected).toBe(0.2);
  });
});

describe("الأدوار والمتبقي", () => {
  it("الفاحص: مراقب الخامات والرئيس بس", () => {
    expect(canInspect("raw_material_quality_controller")).toBe(true);
    expect(canInspect("chairman")).toBe(true);
    expect(canInspect("warehouse_manager")).toBe(false);
  });
  it("فصل المهام ورئيس المجلس مستثنى", () => {
    expect(violatesSeparation("raw_material_quality_controller", 5, 5)).toBe(true);
    expect(violatesSeparation("raw_material_quality_controller", 5, 6)).toBe(false);
    expect(violatesSeparation("chairman", 1, 1)).toBe(false);
  });
  it("المتبقي بيطرح المقبول والمستني فحص", () => {
    expect(receivableRemaining("10", "4", 3)).toBe(3);
    expect(receivableRemaining("10", "4", 7)).toBe(0);
  });
});
