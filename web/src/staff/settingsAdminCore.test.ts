import { describe, expect, it } from "vitest";
import {
  EMPTY_PASSWORD, EMPTY_RULE, EMPTY_USER, cacheKeys, filterUsers, groupSecret, isTotpCode, passwordFormError, passwordProblem, rangeParts, ruleError, rulePayload, ruleTogglePayload, sortRules,
  uptimeParts, userChanged, userError, userFormOf, userPayload, type RuleRow, type UserRow,
} from "./settingsAdminCore";

const U: UserRow = { id: 1, username: "ali", fullName: "علي حسن", role: "buyer", status: "active", createdAt: "2026-01-01" };

describe("قاعدة كلمة سر الموظف", () => {
  it("بترفض القصيرة وتطلب كبير وصغير ورقم", () => {
    expect(passwordProblem("Ab1")).toBe("short");
    expect(passwordProblem("abcdefg1")).toBe("upper");
    expect(passwordProblem("ABCDEFG1")).toBe("lower");
    expect(passwordProblem("Abcdefgh")).toBe("digit");
    expect(passwordProblem("Abcdefg1")).toBeNull();
  });
});

describe("نموذج المستخدم", () => {
  const ok = { ...EMPTY_USER, username: "mona", fullName: "منى", role: "hr", password: "Abcdefg1" };
  it("الإنشاء بيطلب كل الحقول وكلمة سر قوية", () => {
    expect(userError(EMPTY_USER, false)).toBe("username");
    expect(userError({ ...ok, fullName: " " }, false)).toBe("fullName");
    expect(userError({ ...ok, role: "" }, false)).toBe("role");
    expect(userError({ ...ok, password: "abc" }, false)).toBe("password");
    expect(userError(ok, false)).toBeNull();
  });
  it("التعديل: كلمة السر اختيارية لكن لو اتكتبت لازم تكون قوية", () => {
    const f = userFormOf(U);
    expect(userError(f, true)).toBeNull();
    expect(userError({ ...f, password: "weak" }, true)).toBe("password");
    expect(userError({ ...f, password: "Abcdefg1" }, true)).toBeNull();
  });
  it("التعديل بيبعت اللي اتغيّر بس", () => {
    const f = userFormOf(U);
    expect(userPayload(f, U)).toEqual({});
    expect(userChanged(f, U)).toBe(false);
    expect(userPayload({ ...f, role: "hr", status: "inactive" }, U)).toEqual({ role: "hr", status: "inactive" });
    expect(userPayload({ ...f, password: "Abcdefg1" }, U)).toEqual({ password: "Abcdefg1" });
  });
  it("الإنشاء بيبعت كل حاجة ومقصوصة", () => {
    expect(userPayload({ ...ok, username: " mona " })).toEqual({ username: "mona", fullName: "منى", role: "hr", status: "active", password: "Abcdefg1" });
  });
  it("البحث والفلتر", () => {
    const rows = [U, { ...U, id: 2, username: "sara", fullName: "سارة", status: "inactive" as const }];
    expect(filterUsers(rows, "", "")).toHaveLength(2);
    expect(filterUsers(rows, "ALI", "")).toHaveLength(1);
    expect(filterUsers(rows, "سار", "")).toHaveLength(1);
    expect(filterUsers(rows, "", "inactive").map((r) => r.id)).toEqual([2]);
  });
});

describe("قواعد التوصيل", () => {
  it("بتتحقق من الاسم والأرقام والمدى والأولوية", () => {
    expect(ruleError(EMPTY_RULE)).toBe("label");
    const f = { ...EMPTY_RULE, label: "كمية كبيرة" };
    expect(ruleError(f)).toBeNull();
    expect(ruleError({ ...f, minQty: "abc" })).toBe("number");
    expect(ruleError({ ...f, minQty: "10", maxQty: "5" })).toBe("range");
    expect(ruleError({ ...f, minValue: "100", maxValue: "100" })).toBeNull();
    expect(ruleError({ ...f, priority: "x" })).toBe("priority");
  });
  it("الفاضي بيتحول null والأولوية رقم", () => {
    expect(rulePayload({ ...EMPTY_RULE, label: " أ ", minQty: "5", priority: "7" })).toEqual({ label: "أ", minQty: "5", maxQty: null, minValue: null, maxValue: null, timing: "any", deliveryMethod: "warehouse", priority: 7 });
  });
  it("التفعيل بيقلب الحالة والترتيب بالأولوية", () => {
    const r = { id: 2, label: "x", minQty: null, maxQty: null, minValue: null, maxValue: null, timing: "any", deliveryMethod: "customer", priority: 5, isActive: true } as RuleRow;
    expect(ruleTogglePayload(r)).toEqual({ isActive: false });
    expect(sortRules([{ ...r, id: 1, priority: 9 }, r]).map((x) => x.id)).toEqual([2, 1]);
    expect(rangeParts("5.000", null)).toEqual({ min: "5", max: null });
  });
});

describe("عن النظام", () => {
  it("مدة التشغيل", () => {
    expect(uptimeParts(90_061)).toEqual({ days: 1, hours: 1, minutes: 1 });
    expect(uptimeParts(-5)).toEqual({ days: 0, hours: 0, minutes: 0 });
    expect(uptimeParts(Number.NaN)).toEqual({ days: 0, hours: 0, minutes: 0 });
  });
  it("مسح الكاش بيلمس مفاتيح النظام بس", () => {
    expect(cacheKeys(["hyper_erp_cache_a", "theme", "hyper_erp_cache_b"])).toEqual(["hyper_erp_cache_a", "hyper_erp_cache_b"]);
  });
});

describe("حسابي", () => {
  it("تغيير كلمة السر", () => {
    expect(passwordFormError(EMPTY_PASSWORD)).toBe("current");
    expect(passwordFormError({ current: "Old12345", next: "abc", confirm: "abc" })).toBe("short");
    expect(passwordFormError({ current: "Old12345", next: "Old12345", confirm: "Old12345" })).toBe("same");
    expect(passwordFormError({ current: "Old12345", next: "New12345", confirm: "New1234" })).toBe("mismatch");
    expect(passwordFormError({ current: "Old12345", next: "New12345", confirm: "New12345" })).toBeNull();
  });
  it("كود التحقق وتنسيق السر", () => {
    expect(isTotpCode(" 123456 ")).toBe(true);
    expect(isTotpCode("12345")).toBe(false);
    expect(isTotpCode("12345a")).toBe(false);
    expect(groupSecret("ABCDEFGHIJ")).toBe("ABCD EFGH IJ");
  });
});

import { holidayError, holidayPayload, isPastHoliday, sortHolidays } from "./settingsAdminCore";

describe("العطلات", () => {
  const existing = [{ id: 1, date: "2026-12-25", reason: "عيد" }];
  it("تاريخ حقيقي وسبب حرفين وغير مكرر", () => {
    expect(holidayError({ date: "2026-12-30", reason: "إجازة" }, existing)).toBeNull();
    expect(holidayError({ date: "2026-02-30", reason: "إجازة" }, existing)).toBe("date");
    expect(holidayError({ date: "", reason: "إجازة" }, existing)).toBe("date");
    expect(holidayError({ date: "2026-12-30", reason: " ع " }, existing)).toBe("reason");
    expect(holidayError({ date: "2026-12-25", reason: "تاني" }, existing)).toBe("dup");
  });
  it("الإرسال بسبب مقصوص، والترتيب بالتاريخ، والفايت بيتعلّم", () => {
    expect(holidayPayload({ date: "2026-12-30", reason: "  إجازة  " })).toEqual({ date: "2026-12-30", reason: "إجازة" });
    expect(sortHolidays([{ id: 2, date: "2026-12-30", reason: "ب" }, { id: 1, date: "2026-12-25", reason: "أ" }]).map((h) => h.id)).toEqual([1, 2]);
    expect(isPastHoliday({ id: 1, date: "2026-11-01", reason: "أ" }, "2026-11-09")).toBe(true);
    expect(isPastHoliday({ id: 1, date: "2026-11-09", reason: "أ" }, "2026-11-09")).toBe(false);
  });
});
