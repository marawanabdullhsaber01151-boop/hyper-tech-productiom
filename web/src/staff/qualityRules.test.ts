import { describe, expect, it } from "vitest";
import { addTag, autoFailed, checklistScore, inspectable, inspectionBody, inspectionError, predictedVerdict, sampleRate, topTags } from "./qualityRules";

const base = { status: "passed" as const, notes: "", size: "", passed: "", failed: "" };

describe("قواعد فحص الجودة (نفس السيرفر)", () => {
  it("الرسوب من غير سبب مرفوض", () => {
    expect(inspectionError({ ...base, status: "failed" })).toBe("notesOnFail");
    expect(inspectionError({ ...base, status: "failed", notes: "كس" })).toBe("notesOnFail");
    expect(inspectionError({ ...base, status: "failed", notes: "كسر في الغطاء" })).toBeNull();
  });
  it("العينة: أعداد من غير حجم، ومجموع أكبر، وأرقام غلط", () => {
    expect(inspectionError({ ...base, passed: "5" })).toBe("sampleIncomplete");
    expect(inspectionError({ ...base, size: "10", passed: "8", failed: "3" })).toBe("sampleOver");
    expect(inspectionError({ ...base, size: "1.5" })).toBe("badNumber");
    expect(inspectionError({ ...base, size: "10", passed: "10", failed: "0" })).toBeNull();
  });
  it("الاعتماد تحت 95% محتاج مبرر", () => {
    expect(inspectionError({ ...base, size: "100", passed: "90" })).toBe("lowRateNeedsNotes");
    expect(inspectionError({ ...base, size: "100", passed: "90", notes: "درجة تانية بموافقة العميل" })).toBeNull();
    expect(inspectionError({ ...base, size: "100", passed: "95" })).toBeNull();
  });
  it("النسبة والتوقع والفاشل التلقائي", () => {
    expect(sampleRate("40", "38")).toBe(95);
    expect(sampleRate("", "5")).toBeNull();
    expect(predictedVerdict(95)).toBe("pass");
    expect(predictedVerdict(94)).toBe("fail");
    expect(predictedVerdict(null)).toBeNull();
    expect(autoFailed("40", "38")).toBe("2");
    expect(autoFailed("40", "50")).toBe("");
    expect(autoFailed("", "5")).toBe("");
  });
});

describe("قايمة الفحص والعيوب", () => {
  it("الأوامر المتاحة: المسنودة لمراقب الجودة، والكل للإدارة والمهندس", () => {
    const orders = [
      { id: 1, workflowStatus: "quality_check", qualityControllerUserId: 7 },
      { id: 2, workflowStatus: "quality_check", qualityControllerUserId: 8 },
      { id: 3, workflowStatus: "in_production", qualityControllerUserId: 7 },
    ];
    expect(inspectable(orders, "production_quality_controller", 7).map((o) => o.id)).toEqual([1]);
    expect(inspectable(orders, "quality_engineer", 1).map((o) => o.id)).toEqual([1, 2]);
    expect(inspectable(orders, "production_quality_controller", undefined)).toEqual([]);
  });
  it("العيب مايتكررش، والاقتراحات بالأكتر استخدامًا", () => {
    expect(addTag(["كسر"], " كسر ")).toEqual(["كسر"]);
    expect(addTag(["كسر"], "خدش")).toEqual(["كسر", "خدش"]);
    expect(addTag(["كسر"], "  ")).toEqual(["كسر"]);
    expect(topTags([{ defectTags: ["خدش", "كسر"] }, { defectTags: ["خدش"] }, { defectTags: "x" }, {}])).toEqual(["خدش", "كسر"]);
  });
  it("جسم الطلب: أرقام أو null، والدرجة والقايمة", () => {
    expect(inspectionBody({ status: "failed", notes: " كسر ", size: "10", passed: "7", failed: "" }, 3, ["كسر"], [{ label: "الشكل", ok: true }])).toEqual({
      qualityStatus: "failed", qualityNotes: "كسر", performanceRating: 3, sampleSize: 10, samplePassedCount: 7, sampleFailedCount: null, defectTags: ["كسر"], checklist: [{ label: "الشكل", ok: true }],
    });
    expect(checklistScore([{ ok: true }, { ok: false }, { ok: true }])).toEqual({ ok: 2, total: 3 });
  });
});
