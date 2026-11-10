/** @format */
// عروض الأسعار (45أ): قراية الملفات كنص عشان الاختبار ميحتاجش قاعدة بيانات.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");

describe("عروض الأسعار", () => {
  const r = read("src/routes/price-quotes.ts");
  it("كل مسارات الموظفين تحت requireAuth وصلاحية المبيعات، والكتابة بمعاملة وتدقيق", () => {
    for (const m of ['get("/price-quotes", requireAuth, requireRole(...PERMISSIONS.sales.view)', 'post("/price-quotes", requireAuth, requireRole(...PERMISSIONS.sales.write)', 'put("/price-quotes/:id", requireAuth, requireRole(...PERMISSIONS.sales.write)', 'post("/price-quotes/:id/send", requireAuth, requireRole(...PERMISSIONS.sales.write)', 'post("/price-quotes/:id/cancel", requireAuth, requireRole(...PERMISSIONS.sales.write)']) expect(r).toContain(m);
    for (const k of ["quote.created", "quote.updated", "quote.sent", "quote.cancelled"]) expect(r).toContain(`actionKey: "${k}"`);
    expect((r.match(/db\.transaction/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(r).toContain('.for("update")');
  });
  it("مسار lookups قبل /:id عشان ما يتفسّرش كرقم", () => {
    expect(r.indexOf('"/price-quotes/lookups"')).toBeGreaterThan(0);
    expect(r.indexOf('"/price-quotes/lookups"')).toBeLessThan(r.indexOf('"/price-quotes/:id"'));
  });
  it("مسارات العميل بتفلتر بعميله هو ومبتعرضش المسودات ولا أسماء الموظفين", () => {
    expect(r).toContain("getAuthenticatedPortalCustomerId(req)");
    expect(r).toContain(`<> 'draft'`);
    const portal = r.slice(r.indexOf('"/portal/price-quotes"'), r.indexOf('"/portal/price-quotes/:id/decline"'));
    expect(portal).not.toContain("createdByName");
    expect(portal).not.toContain("cancelReason");
  });
  it("الراوتر متسجّل في main وجدول العروض في الـschema", () => {
    const m = read("src/main.ts");
    expect(m).toContain('import priceQuotesRouter from "./routes/price-quotes"');
    expect(m).toContain("apiRouter.use(priceQuotesRouter)");
    expect(read("src/db/schema/index.ts")).toContain('"./price-quotes"');
  });
  it("الهجرة: جدولين وعمودين على أوامر الإنتاج وطريقة رجوع", () => {
    const m = read("migrations/0098_price_quotes.sql");
    expect(m).toContain('CREATE TABLE IF NOT EXISTS "price_quotes"');
    expect(m).toContain('CREATE TABLE IF NOT EXISTS "price_quote_lines"');
    expect(m).toContain('"quote_id" integer REFERENCES "price_quotes"');
    expect(m).toContain('"agreed_unit_price" numeric(12,2)');
    expect(m).toContain("Rollback");
  });
});

describe("الطلب من العرض بيقفل السعر", () => {
  const p = read("src/routes/portal.ts");
  it("الطلب بيقبل quoteId، والسطور من العرض مش من العميل، والعرض بيتقفل بالمعاملة", () => {
    expect(p).toContain("quoteId: z.number().int().positive().optional()");
    expect(p).toContain("orderRefusal(quote ?? null, customer.id, todayCairo(new Date()))");
    expect(p).toContain("sourceItems = quoteLines.map");
    expect(p).toContain('.for("update")');
    expect(p).toContain('status: "ordered"');
    expect(p).toContain("agreedUnitPrice,");
    expect(p).toContain("const referenceUnitPrice = agreedUnitPrice ?? recipe.referencePrice");
  });
  it("مراجعة المبيعات بترفض أي سعر مختلف عن المتفق عليه", () => {
    const o = read("src/routes/portal-orders.ts");
    expect(o).toContain("agreedPriceIssue(order.agreedUnitPrice, priceMap.get(order.id)!)");
    expect(o).toContain("السعر متفق عليه في عرض سعر");
  });
  it("الإشعار للعميل خارجي (إيميل/تيليجرام) والإعداد الافتراضي للصلاحية موجود", () => {
    expect(read("src/lib/portalNoticeCore.ts")).toContain('"portal_price_quote_sent"');
    const reg = read("src/domain/settings-registry.ts");
    expect(reg).toContain('key: "quotes.validity_days"');
    expect(reg).toContain('default: "14", min: 1, max: 180');
  });
});

describe("واجهة العروض", () => {
  it("صفحة الموظفين في الراوتر والقايمة، وتبويب العميل وروابط الإشعار", () => {
    expect(read("web/src/app/App.tsx")).toContain('path: "/staff/quotes"');
    expect(read("src/lib/departments.ts")).toContain('href: "/v2/staff/quotes"');
    expect(read("web/src/portal/screens/Orders.tsx")).toContain('tab=quotes');
    expect(read("web/src/portal/screens/Notifications.tsx")).toContain('"price_quote"');
    expect(read("web/src/portal/screens/PriceQuotes.tsx")).toContain("quoteId: quote.id");
  });
  it("الدرج بيقفل خانة السعر لما السعر متفق عليه", () => {
    const d = read("web/src/admin/screens/OrderDrawer.tsx");
    expect(d).toContain("l.agreedUnitPrice ?? prices[l.id]");
    expect(d).toContain("disabled={!!l.agreedUnitPrice}");
  });
});
