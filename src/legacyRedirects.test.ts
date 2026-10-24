import { describe, expect, it } from "vitest";
import { MATERIAL_REDIRECT_TARGET, chatStaffRedirectTarget, inventoryRedirectTarget, portalRedirectTarget, salesRedirectTarget } from "./lib/legacyRedirects";

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

describe("تحويل صفحات بوابة العميل القديمة", () => {
  it("كل صفحة قديمة بتروح مكانها الجديد", () => {
    expect(portalRedirectTarget("/portal.html", "")).toBe("/v2/portal/home");
    expect(portalRedirectTarget("/portal-login.html", "")).toBe("/v2/portal/login");
    expect(portalRedirectTarget("/portal-recover.html", "")).toBe("/v2/portal/recover");
    expect(portalRedirectTarget("/portal-chat.html", "")).toBe("/v2/portal/chat");
    expect(portalRedirectTarget("/other.html", "")).toBeNull();
  });
  it("رابط التفعيل القديم بيحافظ على التوكن (وعلى mode=reset)", () => {
    expect(portalRedirectTarget("/portal-activate.html", "token=abcdef123456")).toBe("/v2/portal/activate?token=abcdef123456");
    expect(portalRedirectTarget("/portal-activate.html", "mode=reset&token=abcdef123456")).toBe("/v2/portal/activate?token=abcdef123456&mode=reset");
  });
  it("إشارة الشات القديمة ctx بتتحوّل لـ context، والباقي بيتشال", () => {
    expect(portalRedirectTarget("/portal-chat.html", "ctx=product:12&topic=product")).toBe("/v2/portal/chat?context=product%3A12");
    expect(portalRedirectTarget("/portal-chat.html", "ctx=javascript:alert(1)")).toBe("/v2/portal/chat");
  });
  it("باراميترات غريبة (توكن قصير/فيه رموز، redirect خارجي) بتتشال", () => {
    expect(portalRedirectTarget("/portal-activate.html", "token=x")).toBe("/v2/portal/activate");
    expect(portalRedirectTarget("/portal-activate.html", "token=abc<script>12345&next=//evil.com")).toBe("/v2/portal/activate");
    expect(portalRedirectTarget("/portal-login.html", "next=//evil.com")).toBe("/v2/portal/login");
  });
});

describe("الرئيسية القديمة", () => {
  it("/ و/index.html بيروحوا للرئيسية الجديدة", async () => {
    const m = await import("./lib/legacyRedirects");
    expect(m.LEGACY_HOME_PATHS).toEqual(["/", "/index.html"]);
    expect(m.STAFF_HOME_PATH).toBe("/v2/staff");
  });
});

describe("صفحة المبيعات القديمة", () => {
  it("بتروح للصفحة الجديدة وبتحافظ على القناة والحالة", () => {
    expect(salesRedirectTarget("")).toBe("/v2/staff/sales");
    expect(salesRedirectTarget("channel=website")).toBe("/v2/staff/sales?channel=website");
    expect(salesRedirectTarget("channel=direct&status=paid")).toBe("/v2/staff/sales?channel=direct&status=paid");
  });
  it("قيم غريبة وباراميترات تانية بتتشال", () => {
    expect(salesRedirectTarget("channel=//evil.com&next=//evil.com")).toBe("/v2/staff/sales");
    expect(salesRedirectTarget("status=drop table")).toBe("/v2/staff/sales");
  });
});

describe("صفحتا المخزن والحركات القديمتان", () => {
  it("المخزن ← صفحة المخزون وبيحافظ على البحث", () => {
    expect(inventoryRedirectTarget("")).toBe("/v2/staff/stock");
    expect(inventoryRedirectTarget("q=%D8%AE%D9%8A%D8%B7")).toBe("/v2/staff/stock?q=%D8%AE%D9%8A%D8%B7");
  });
  it("الحركات ← تبويب الحركات (والصنف لو رقم صحيح)", () => {
    expect(inventoryRedirectTarget("", true)).toBe("/v2/staff/stock?tab=movements");
    expect(inventoryRedirectTarget("item=12", true)).toBe("/v2/staff/stock?tab=movements&item=12");
    expect(inventoryRedirectTarget("item=//evil.com&next=x", true)).toBe("/v2/staff/stock?tab=movements");
  });
});

describe("صفحة المواد الخام القديمة", () => {
  it("بتروح للمخزون مفلتر على المواد الخام", () => {
    expect(MATERIAL_REDIRECT_TARGET).toBe("/v2/staff/stock?cat=raw_material");
  });
});
