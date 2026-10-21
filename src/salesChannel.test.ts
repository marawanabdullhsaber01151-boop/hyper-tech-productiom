/** @format */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getNavForRole } from "./lib/departments";
import { USER_ROLES } from "./lib/roles";
import { listScope, manualCreateChannel, parseChannel, PORTAL_INVOICE_NOTE_PREFIX } from "./lib/salesChannel";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const salesLinks = (role: string) =>
  getNavForRole(role as (typeof USER_ROLES)[number]).flatMap((d) => d.subFunctions.flatMap((s) => s.pages.filter((p) => p.href.startsWith("sales.html")).map((p) => p.href)));

describe("نطاق القائمة حسب القناة", () => {
  it("بائع الأونلاين يشوف كل فواتير الأونلاين (مش فواتيره بس) ومن غير فلتر منشئ", () => {
    expect(listScope("online_seller", 5, "direct")).toEqual({ channel: "website" });
  });
  it("بائع الأوفلاين: فواتيره هو في قناة الأوفلاين، ومينفعش يطلب قناة تانية", () => {
    expect(listScope("offline_seller", 9, "website")).toEqual({ channel: "direct", createdById: 9 });
  });
  it("باقي الأدوار: بالفلتر أو الكل", () => {
    expect(listScope("sales_manager", 1, "website")).toEqual({ channel: "website" });
    expect(listScope("chairman", 1, undefined)).toEqual({ channel: undefined });
    expect(listScope("chairman", 1, "xx")).toEqual({ channel: undefined });
  });
  it("parseChannel", () => {
    expect(parseChannel("website")).toBe("website");
    expect(parseChannel("direct")).toBe("direct");
    expect(parseChannel("phone")).toBe(undefined);
    expect(parseChannel(5)).toBe(undefined);
  });
});

describe("الإنشاء اليدوي", () => {
  it("بائع الأونلاين ممنوع (403) برسالة عربية", () => {
    try {
      manualCreateChannel("online_seller");
      throw new Error("لازم يرمي");
    } catch (e) {
      expect((e as { status?: number }).status).toBe(403);
      expect((e as Error).message).toContain("تلقائيًا");
    }
  });
  it("طلب قناة الأونلاين يدويًا من أي دور ← 400", () => {
    for (const r of ["sales_manager", "chairman", "offline_seller", "hr"]) {
      try {
        manualCreateChannel(r, "website");
        throw new Error("لازم يرمي");
      } catch (e) {
        expect((e as { status?: number }).status).toBe(400);
      }
    }
  });
  it("غير كده: أوفلاين دايمًا", () => {
    expect(manualCreateChannel("offline_seller")).toBe("direct");
    expect(manualCreateChannel("sales_manager", "direct")).toBe("direct");
    expect(manualCreateChannel("chairman", undefined)).toBe("direct");
  });
});

describe("حراسة الربط (الخلل الأصلي ما يرجعش)", () => {
  it("طلبات البوابة بتسجّل الفاتورة قناتها website، وعلامة الملاحظة مطابقة لنص الترحيل", () => {
    const src = read("src/routes/portal-orders.ts");
    expect(src).toMatch(/channel: "website",\s*\n\s*date:/);
    expect(src).toContain(PORTAL_INVOICE_NOTE_PREFIX);
    expect(read("migrations/0080_sales_channel_backfill.sql")).toContain(PORTAL_INVOICE_NOTE_PREFIX);
  });
  it("راوت المبيعات بيستخدم القواعد (الإنشاء اليدوي والفلتر)", () => {
    const src = read("src/routes/sales.ts");
    expect(src).toContain("manualCreateChannel(req.user!.role");
    expect(src).toContain("listScope(req.user!.role");
    expect(src).not.toMatch(/orderData\.channel\s*=\s*req\.user!\.role === "online_seller"/);
  });
  it("القايمة: مدخلين مختلفين لصفحة المبيعات (أونلاين/أوفلاين) برابطين ومعرّفين مختلفين", () => {
    expect(salesLinks("online_seller")).toEqual(["sales.html?channel=website"]);
    expect(salesLinks("offline_seller")).toEqual(["sales.html?channel=direct"]);
    expect(salesLinks("sales_manager").sort()).toEqual(["sales.html?channel=direct", "sales.html?channel=website"]);
    const ids = getNavForRole("chairman").flatMap((d) => d.subFunctions.flatMap((s) => s.pages.map((p) => p.id)));
    expect(ids.filter((i) => i.startsWith("sales-")).length).toBeGreaterThanOrEqual(2);
    expect(ids).not.toContain("sales");
  });
  it("صفحة المبيعات: بتبعت القناة للسيرفر، وبتخفي زر الإنشاء في الأونلاين، وبتعرض «بانتظار الاعتماد»", () => {
    const js = read("public/JS/sales.js");
    expect(js).toContain('params.set("channel", channel)');
    expect(js).toContain('newBtn.hidden = channel === "website"');
    expect(js).toContain("pending_approval");
    expect(js).not.toMatch(/statusMap\[inv\.status\] \|\| statusMap\.draft/);
    expect(read("public/sales.html")).toContain('data-status="pending_approval"');
  });
});
