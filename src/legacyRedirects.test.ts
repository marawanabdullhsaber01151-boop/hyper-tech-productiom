import { describe, expect, it } from "vitest";
import { chatStaffRedirectTarget } from "./lib/legacyRedirects";

describe("تحويل رابط شات الإدارة القديم", () => {
  it("بدون رقم → صندوق المحادثات", () => {
    expect(chatStaffRedirectTarget(undefined)).toBe("/v2/admin/portal-chat");
  });
  it("رقم صحيح (إشعار قديم) → المحادثة نفسها", () => {
    expect(chatStaffRedirectTarget("42")).toBe("/v2/admin/portal-chat/42");
    expect(chatStaffRedirectTarget(["7", "9"])).toBe("/v2/admin/portal-chat/7");
  });
  it("قيم غريبة مش بتتحوّل لمسار تاني (open redirect)", () => {
    for (const bad of ["//evil.com", "../x", "1e9", "-3", "0", "12abc", "9999999999", { a: 1 }]) {
      expect(chatStaffRedirectTarget(bad)).toBe("/v2/admin/portal-chat");
    }
  });
});
