/** @format */
import { describe, expect, it } from "vitest";
import { NCR_CLOSE_ROLES, NCR_DISPOSITIONS, PRODUCTION_REQUEST_VIEW_ROLES, checkNcrClose } from "./productionQualityCore";

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
