import { describe, expect, it } from "vitest";
import { changedPayload, defsOf, dirtyKeys, displayValue, validateDraft, type SettingDef } from "./settingsCore";

const defs: SettingDef[] = [
  { key: "company_name", group: "company", type: "text", label: "اسم الشركة", default: "", maxLength: 10 },
  { key: "company_email", group: "company", type: "email", label: "إيميل", default: "" },
  { key: "currency", group: "company", type: "select", label: "العملة", default: "EGP", options: [{ value: "EGP", label: "جنيه مصري" }] },
  { key: "work.start_hour", group: "operations", type: "int", label: "بداية", default: "9", min: 0, max: 23, unit: "ساعة" },
  { key: "work.end_hour", group: "operations", type: "int", label: "نهاية", default: "17", min: 1, max: 24, unit: "ساعة" },
];
const saved = { company_name: "هايبر", company_email: "", currency: "EGP", "work.start_hour": "9", "work.end_hour": "17" };

describe("مركز الإعدادات", () => {
  it("تقسيم المجموعات", () => {
    expect(defsOf(defs, "company").map((d) => d.key)).toEqual(["company_name", "company_email", "currency"]);
    expect(defsOf(defs, "operations").length).toBe(2);
  });
  it("المتغيّر فعلًا بس هو اللي يتبعت", () => {
    const draft = { ...saved, "work.start_hour": "8", company_name: "هايبر" };
    expect(dirtyKeys(defs, saved, draft)).toEqual(["work.start_hour"]);
    expect(changedPayload(["work.start_hour"], draft)).toEqual({ "work.start_hour": "8" });
    expect(dirtyKeys(defs, saved, {})).toEqual([]);
  });
  it("التحقق", () => {
    expect(validateDraft(defs, saved)).toEqual({});
    expect(validateDraft(defs, { ...saved, company_name: "" }).company_name).toBe("required");
    expect(validateDraft(defs, { ...saved, company_name: "x".repeat(11) }).company_name).toBe("length");
    expect(validateDraft(defs, { ...saved, company_email: "abc" }).company_email).toBe("email");
    expect(validateDraft(defs, { ...saved, "work.start_hour": "x" })["work.start_hour"]).toBe("number");
    expect(validateDraft(defs, { ...saved, "work.start_hour": "30" })["work.start_hour"]).toBe("range");
    expect(validateDraft(defs, { ...saved, "work.end_hour": "9" })["work.end_hour"]).toBe("hours");
  });
  it("عرض القيمة", () => {
    expect(displayValue(defs[2], "EGP")).toBe("جنيه مصري");
    expect(displayValue(defs[3], "9")).toBe("9 ساعة");
    expect(displayValue(defs[0], "")).toBe("—");
    expect(displayValue(undefined, "x")).toBe("x");
  });
});
