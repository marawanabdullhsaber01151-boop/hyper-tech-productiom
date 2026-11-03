import { describe, expect, it } from "vitest";
import { canReadNotes, canWriteNotes, hoursLabel, noteError, notePayload, noteTone, stalledMap } from "./oversightCore";

describe("oversightCore", () => {
  it("القراءة أوسع من الكتابة بالمدير التنفيذي بس", () => {
    expect(canWriteNotes("supervisor")).toBe(true);
    expect(canWriteNotes("executive_manager")).toBe(false);
    expect(canReadNotes("executive_manager")).toBe(true);
    expect(canReadNotes("sales_manager")).toBe(false);
    expect(canReadNotes(undefined)).toBe(false);
  });
  it("نص الملاحظة 3 حروف على الأقل، والنوع المجهول بيرجع ملاحظة", () => {
    expect(noteError("  ab ")).toBe("body");
    expect(noteError("الماكينة بتسخن")).toBeNull();
    expect(notePayload("zzz", " تجربة ")).toEqual({ kind: "observation", body: "تجربة" });
    expect(notePayload("issue", "عطل")).toEqual({ kind: "issue", body: "عطل" });
  });
  it("ألوان الأنواع وخريطة الواقف وتقريب الساعات", () => {
    expect(noteTone("issue")).toBe("danger");
    expect(noteTone("handover")).toBe("brand");
    const m = stalledMap([{ id: 3, orderNumber: "A", workflowStatus: "in_production", idleHours: 30.7, thresholdHours: 24, ratio: 1.3 }]);
    expect(m.get(3)?.orderNumber).toBe("A");
    expect(stalledMap(undefined).size).toBe(0);
    expect(hoursLabel(30.7)).toBe("30");
  });
});
