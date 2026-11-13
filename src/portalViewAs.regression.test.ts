/** @format */
// شاهد كما يراه العميل (47): قراية الملفات كنص عشان الاختبار ميحتاجش قاعدة بيانات.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");

describe("شاهد كما يراه العميل", () => {
  const r = read("src/routes/portal-view-as.ts");
  it("مسار واحد بس، تحت requireAuth وصلاحية الشركات، ومفيش أي كتابة غير سجل التدقيق", () => {
    expect((r.match(/router\.(get|post|put|patch|delete)\(/g) ?? []).length).toBe(1);
    expect(r).toContain('router.post("/portal-companies/:id/view-as", requireAuth, requireRole(...PERMISSIONS.portalCompanies.view)');
    expect(r).not.toMatch(/\.(insert|update|delete)\(/);
  });
  it("الفتح بيتسجّل بسبب إجباري وبمفتاح ظاهر في السجل، قبل ما أي بيانات تتقرا", () => {
    expect(r).toContain('actionKey: "portal.customer_view"');
    expect(r).toContain(".min(3");
    expect(r.indexOf("await writeAuditEvent(")).toBeGreaterThan(0);
    expect(r.indexOf("await writeAuditEvent(")).toBeLessThan(r.indexOf(".from(productionWorkflowOrdersTable)"));
    expect(r.indexOf("await writeAuditEvent(")).toBeLessThan(r.indexOf("await portalQuoteItems(id)"));
    // المفتاح مش «.viewed» عشان مايتخباش من سجل النشاط
    expect(r).not.toContain('portal.customer_viewed');
  });
  it("العروض والاتفاقيات من نفس دوال البوابة، فالعميل والموظف بيشوفوا نفس الحاجة", () => {
    expect(read("src/routes/price-quotes.ts")).toContain("res.json({ items: await portalQuoteItems(");
    expect(read("src/routes/price-agreements.ts")).toContain("res.json({ items: await portalAgreementItems(");
  });
  it("مفيش بيانات داخلية في اللقطة (ملاحظات الموظفين، أسماء الموظفين، كلمات السر)", () => {
    expect(r).not.toContain("passwordHash");
    expect(r).not.toContain("createdByName");
    expect(r).not.toContain("warehouseComment");
  });
  it("الراوتر متركب، والواجهة بتستدعي المسار وفيها زرار في درج الشركة", () => {
    expect(read("src/main.ts")).toContain("apiRouter.use(portalViewAsRouter)");
    expect(read("web/src/admin/screens/ViewAs.tsx")).toContain("/view-as");
    expect(read("web/src/admin/screens/CompanyDrawer.tsx")).toContain("<ViewAs ");
  });
});
