/** @format */
import { describe, expect, it } from "vitest";
import { NCR_CLOSE_ROLES, NCR_DISPOSITIONS, PRODUCTION_REQUEST_VIEW_ROLES, QUALITY_DECIDE_ROLES, checkNcrClose, checkQualityDone } from "./productionQualityCore";

describe("قفل حالة عدم المطابقة", () => {
  it("بيرفض القفل من غير سبب جذري أو إجراء تصحيحي", () => {
    expect(checkNcrClose({ status: "open", rootCause: "", correctiveAction: "ضبط الماكينة" })).toMatchObject({ ok: false, code: "ROOT_CAUSE_REQUIRED" });
    expect(checkNcrClose({ status: "open", rootCause: "عطل", correctiveAction: " " })).toMatchObject({ ok: false, code: "ACTION_REQUIRED" });
    expect(checkNcrClose({ status: "open", rootCause: "ab", correctiveAction: "ضبط" })).toMatchObject({ ok: false, code: "ROOT_CAUSE_REQUIRED" });
  });
  it("بيرفض قفل حالة مقفولة أصلًا، حتى لو البيانات كاملة", () => {
    expect(checkNcrClose({ status: "closed", rootCause: "عطل", correctiveAction: "إصلاح" })).toMatchObject({ ok: false, code: "ALREADY_CLOSED" });
  });
  it("بيقبل ويرجّع النص بعد تنضيف المسافات", () => {
    expect(checkNcrClose({ status: "open", rootCause: "  حرارة عالية ", correctiveAction: " ضبط الحرارة  " })).toEqual({ ok: true, rootCause: "حرارة عالية", correctiveAction: "ضبط الحرارة" });
  });
  it("القوائم الثابتة", () => {
    expect(NCR_DISPOSITIONS).toContain("use_as_is");
    expect(NCR_CLOSE_ROLES).not.toContain("supervisor");
    expect(PRODUCTION_REQUEST_VIEW_ROLES).toContain("storekeeper");
  });
});

describe("قرار فحص الجودة", () => {
  it("الرسوب من غير سبب مرفوض، وبسبب مقبول", () => {
    expect(checkQualityDone({ qualityStatus: "failed" })).toMatchObject({ ok: false, code: "NOTES_REQUIRED_ON_FAIL" });
    expect(checkQualityDone({ qualityStatus: "failed", qualityNotes: "  " })).toMatchObject({ ok: false, code: "NOTES_REQUIRED_ON_FAIL" });
    expect(checkQualityDone({ qualityStatus: "failed", qualityNotes: "كسر في الغطاء" })).toMatchObject({ ok: true });
  });
  it("العينة: الأعداد من غير حجم مرفوضة، والمجموع الأكبر من الحجم مرفوض", () => {
    expect(checkQualityDone({ qualityStatus: "passed", samplePassedCount: 5 })).toMatchObject({ ok: false, code: "SAMPLE_INCOMPLETE" });
    expect(checkQualityDone({ qualityStatus: "passed", sampleSize: 10, samplePassedCount: 8, sampleFailedCount: 3 })).toMatchObject({ ok: false, code: "SAMPLE_OVER_SIZE" });
  });
  it("الاعتماد تحت 95% محتاج مبرر، وفوقها مش محتاج", () => {
    expect(checkQualityDone({ qualityStatus: "passed", sampleSize: 100, samplePassedCount: 90 })).toMatchObject({ ok: false, code: "PASS_BELOW_RATE_NEEDS_NOTES" });
    expect(checkQualityDone({ qualityStatus: "passed", sampleSize: 100, samplePassedCount: 90, qualityNotes: "عميل وافق على الدرجة الثانية" })).toEqual({ ok: true, rate: 90 });
    expect(checkQualityDone({ qualityStatus: "passed", sampleSize: 100, samplePassedCount: 95 })).toEqual({ ok: true, rate: 95 });
    expect(checkQualityDone({ qualityStatus: "passed" })).toEqual({ ok: true, rate: null });
  });
  it("المشرف مش من أدوار قرار الجودة (فصل المهام)", () => {
    expect(QUALITY_DECIDE_ROLES).not.toContain("supervisor");
    expect(QUALITY_DECIDE_ROLES).toContain("production_quality_controller");
  });
});
