import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PAYMENT_TERMS } from "./lib/paymentTerms";
import { getNavForRole } from "./lib/departments";
import type { USER_ROLES } from "./lib/roles";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("شروط الدفع (42ج)", () => {
  it("الإعداد موجود بنفس القايمة المغلقة، عام ولكل شركة، والموظف بس يعدّله", () => {
    // من غير import للملف (بيفتح اتصال القاعدة): بنقرا سطر التعريف كنص
    const src = read("src/lib/portalSettings.ts");
    const line = src.split("\n").find((l) => l.includes('key: "orders.payment_terms"')) ?? "";
    expect(line).not.toBe("");
    expect(line).toContain('default: "cash"');
    expect(line).toContain('scopes: ["global", "company"]');
    expect(line).toContain('editableBy: ["staff"]');
    for (const v of PAYMENT_TERMS) expect(line).toContain(`"${v}"`);
  });
  it("الطلب بيسجّل لقطة شروط الدفع من السيرفر، والهجرة 0095 بتضيف العمود", () => {
    const r = read("src/routes/portal.ts");
    expect(r).toContain('orderSettings.get<string>("orders.payment_terms")');
    expect(r).toMatch(/piecesPerCarton: cartonAtOrder[^\n]*\n\s+paymentTerms,/);
    expect(read("migrations/0095_order_payment_terms.sql")).toContain('ADD COLUMN IF NOT EXISTS "payment_terms" text');
  });
  it("العميل يشوف الشروط قبل التأكيد، والمسار محمي بدخول البوابة", () => {
    expect(read("src/routes/portal.ts")).toMatch(/"\/portal\/order-terms", requirePortalAuth/);
    expect(read("web/src/portal/screens/Cart.tsx")).toContain("/portal/order-terms");
  });
  it("مديرو المبيعات والمخازن والمشتريات عندهم رابط التقارير في القايمة", () => {
    for (const role of ["sales_manager", "warehouse_manager", "purchasing_manager", "production_manager"]) {
      const ids = getNavForRole(role as (typeof USER_ROLES)[number]).flatMap((d) => d.subFunctions.flatMap((s) => s.pages.map((p) => p.id)));
      expect(ids, role).toContain("reports");
    }
  });
});
