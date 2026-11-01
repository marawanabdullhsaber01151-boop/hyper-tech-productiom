import { describe, expect, it } from "vitest";
import { DOWNTIME_REASONS, EXEC_QTY_RE, batchBalance, canConfirmBatch, canExecuteBatch, closeBlockReason, confirmError, confirmPayload, downtimeError, downtimePayload, traceLotError, traceLotPayload } from "./executionCore";

const B = (o: Partial<{ plannedQty: string; producedQty: string; acceptedQty: string; reworkQty: string; scrapQty: string; status: string }> = {}) => ({ plannedQty: "100", producedQty: "0", acceptedQty: "0", reworkQty: "0", scrapQty: "0", status: "open", ...o });

describe("صلاحية التنفيذ", () => {
  it("المشرف ومدير الإنتاج ينفذوا، والجودة والمخزن لأ", () => {
    expect(canExecuteBatch("supervisor")).toBe(true);
    expect(canExecuteBatch("chairman")).toBe(true);
    expect(canExecuteBatch("production_quality_controller")).toBe(false);
    expect(canExecuteBatch("warehouse_manager")).toBe(false);
  });
});

describe("ميزان الدفعة", () => {
  it("المنتج = مقبول + إعادة + هالك → فرق صفر", () => {
    expect(batchBalance(B({ producedQty: "100", acceptedQty: "90", reworkQty: "6", scrapQty: "4" })).gap).toBe(0);
  });
  it("فرق عشري صغير جدًا بيتحسب صفر (نفس سماحية السيرفر)", () => {
    expect(batchBalance(B({ producedQty: "0.3", acceptedQty: "0.1", reworkQty: "0.1", scrapQty: "0.1" })).gap).toBe(0);
  });
  it("الفرق الحقيقي بيظهر، ونسبة التقدم من المقبول على المخطط", () => {
    const x = batchBalance(B({ producedQty: "50", acceptedQty: "25" }));
    expect(x.gap).toBe(25);
    expect(x.progressPct).toBe(25);
  });
  it("مخطط صفر → نسبة صفر بدون قسمة على صفر", () => {
    expect(batchBalance(B({ plannedQty: "0" })).progressPct).toBe(0);
  });
});

describe("سبب منع القفل (بنفس ترتيب السيرفر)", () => {
  it("مقفولة، ما فيهاش إنتاج، غير موزونة، أكتر من المخطط، أو ينفع", () => {
    expect(closeBlockReason(B({ status: "completed" }))).toBe("done");
    expect(closeBlockReason(B())).toBe("nothing");
    expect(closeBlockReason(B({ producedQty: "10", acceptedQty: "5" }))).toBe("gap");
    expect(closeBlockReason(B({ producedQty: "120", acceptedQty: "120" }))).toBe("over");
    expect(closeBlockReason(B({ producedQty: "10", acceptedQty: "8", scrapQty: "2" }))).toBeNull();
  });
  it("التأكيد ممنوع على المقفولة بس", () => {
    expect(canConfirmBatch(B({ status: "completed" }))).toBe(false);
    expect(canConfirmBatch(B({ status: "in_progress" }))).toBe(true);
  });
});

describe("تأكيد عملية", () => {
  const ok = { operationNo: "10", shiftCode: "", goodQty: "5", scrapQty: "", reworkQty: "", notes: "" };
  it("رقم العملية موجب صحيح", () => {
    for (const bad of ["", "0", "-1", "1.5", "abc", "1234567"]) expect(confirmError({ ...ok, operationNo: bad })).toBe("operationNo");
    expect(confirmError(ok)).toBeNull();
  });
  it("الكميات بحد أقصى 3 خانات عشرية وبدون صيغ علمية", () => {
    expect(confirmError({ ...ok, goodQty: "1.2345" })).toBe("qty");
    expect(confirmError({ ...ok, goodQty: "1e3" })).toBe("qty");
    expect(confirmError({ ...ok, goodQty: "1.234" })).toBeNull();
    expect(EXEC_QTY_RE.test("-1")).toBe(false);
  });
  it("لازم كمية واحدة على الأقل أكبر من صفر", () => {
    expect(confirmError({ ...ok, goodQty: "" })).toBe("empty");
    expect(confirmError({ ...ok, goodQty: "0" })).toBe("empty");
    expect(confirmError({ ...ok, goodQty: "", scrapQty: "1" })).toBeNull();
  });
  it("الجسم: الفاضي يبقى صفر، والاختياري ما يتبعتش لو فاضي", () => {
    expect(confirmPayload(ok)).toEqual({ operationNo: 10, goodQty: "5", scrapQty: "0", reworkQty: "0" });
    expect(confirmPayload({ ...ok, shiftCode: " A ", notes: " ملاحظة " })).toMatchObject({ shiftCode: "A", notes: "ملاحظة" });
  });
});

describe("توقف", () => {
  it("السبب من القايمة والدقائق عدد صحيح موجب", () => {
    expect(downtimeError("", "5")).toBe("reason");
    expect(downtimeError("حاجة", "5")).toBe("reason");
    expect(downtimeError("power_outage", "0")).toBe("minutes");
    expect(downtimeError("power_outage", "2.5")).toBe("minutes");
    expect(downtimeError("power_outage", "30")).toBeNull();
    for (const r of DOWNTIME_REASONS) expect(downtimeError(r, "1")).toBeNull();
  });
  it("الجسم", () => {
    expect(downtimePayload("other", " 15 ", "")).toEqual({ reasonCode: "other", minutes: 15 });
    expect(downtimePayload("other", "15", " عطل ")).toEqual({ reasonCode: "other", minutes: 15, notes: "عطل" });
  });
});

describe("تسجيل تشغيلة", () => {
  it("رقم التشغيلة مطلوب والكمية اختيارية بس صحيحة", () => {
    expect(traceLotError({ lotNumber: " ", quantity: "" })).toBe("lot");
    expect(traceLotError({ lotNumber: "L1", quantity: "x" })).toBe("qty");
    expect(traceLotError({ lotNumber: "L1", quantity: "" })).toBeNull();
  });
  it("الجسم بيشيل الفاضي", () => {
    expect(traceLotPayload({ batchId: 2, workflowOrderId: 3, traceType: "output_lot", lotNumber: " L1 ", itemCode: "", quantity: "" })).toEqual({ batchId: 2, workflowOrderId: 3, traceType: "output_lot", lotNumber: "L1" });
  });
});
