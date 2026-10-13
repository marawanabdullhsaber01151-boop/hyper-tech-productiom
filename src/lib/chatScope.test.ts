/** @format */
import { describe, expect, it } from "vitest";
import { scopeFrom } from "./chatScopeCore";

describe("scopeFrom", () => {
  it("مشتركة: دايمًا محادثة الشركة", () => {
    expect(scopeFrom("shared", 5, true)).toEqual({ mode: "shared", memberId: null, canMonitor: false });
  });
  it("لكل موظف: محادثة الموظف، ومفيش مراقبة", () => {
    expect(scopeFrom("per_member", 5, true)).toEqual({ mode: "per_member", memberId: 5, canMonitor: false });
  });
  it("مع مراقبة: بس اللي معاه الصلاحية", () => {
    expect(scopeFrom("per_member_monitored", 5, true).canMonitor).toBe(true);
    expect(scopeFrom("per_member_monitored", 5, false).canMonitor).toBe(false);
  });
  it("جلسة من غير موظف بترجع للمشتركة", () => {
    expect(scopeFrom("per_member", null, false).memberId).toBeNull();
  });
});
