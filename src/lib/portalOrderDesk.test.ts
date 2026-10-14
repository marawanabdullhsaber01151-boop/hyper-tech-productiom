/** @format */
import { describe, expect, it } from "vitest";
import { batchProgress, batchStatus, lineStage } from "./portalOrderDesk";

describe("lineStage", () => {
  it("بيصنّف المراحل", () => {
    expect(lineStage("cancelled")).toBe("cancelled");
    expect(lineStage("awaiting_operations_claim")).toBe("preparing");
    expect(lineStage("materials_approved")).toBe("preparing");
    expect(lineStage("in_production")).toBe("production");
    expect(lineStage("delivery_pending_customer")).toBe("ready");
    expect(lineStage("delivered_warehouse")).toBe("delivered");
  });
});

describe("batchStatus", () => {
  it("قرار المراجعة أقوى", () => {
    expect(batchStatus("rejected", ["cancelled"])).toBe("rejected");
    expect(batchStatus("confirmed", ["in_production"])).toBe("confirmed");
  });
  it("من غير مراجعة: ملغي لو كله ملغي، وإلا مستني", () => {
    expect(batchStatus(null, ["cancelled", "cancelled"])).toBe("cancelled");
    expect(batchStatus(null, ["cancelled", "new"])).toBe("pending");
    expect(batchStatus(undefined, [])).toBe("pending");
  });
});

describe("batchProgress", () => {
  it("أبطأ صنف شغّال هو اللي بيحدد", () => {
    expect(batchProgress(["in_production", "delivered_customer", "cancelled"])).toBe("production");
    expect(batchProgress(["delivered_customer", "cancelled"])).toBe("delivered");
    expect(batchProgress(["cancelled"])).toBeNull();
  });
});
