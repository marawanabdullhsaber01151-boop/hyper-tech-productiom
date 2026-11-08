import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("عرض الكراتين والقطع (42ب)", () => {
  it("الهجرة 0094 بتضيف عمود عدد القطع في الكرتونة على أوامر الإنتاج وبس", () => {
    const m = read("migrations/0094_order_pieces_per_carton.sql");
    expect(m).toContain('ADD COLUMN IF NOT EXISTS "pieces_per_carton" integer');
    expect(read("src/db/schema/production-workflow.ts")).toContain('pieces_per_carton');
  });
  it("تأكيد الطلب بيسجّل عدد القطع في الكرتونة من السيرفر (مش من العميل)", () => {
    const r = read("src/routes/portal.ts");
    expect(r).toContain("loadCartonConversions(canonicalItems.map");
    expect(r).toContain("piecesPerCarton: cartonAtOrder.get(item.bomRecipeId)?.piecesPerCarton ?? null");
    expect(read("src/domain/portal-orders.ts")).toContain("piecesPerCarton");
  });
  it("قايمة المنتجات والسلة بيرجّعوا تحويل الكرتونة", () => {
    const r = read("src/routes/portal.ts");
    expect(r).toContain("cartonConversion: cartonByRecipe.get(r.id) ?? null");
    expect(r).toContain("cartonConversion: byRecipe.get(i.recipeId) ?? null");
  });
  it("شاشات الموظف والعميل بتعرض الكراتين من نفس الدوال", () => {
    expect(read("web/src/staff/ProductionOrders.tsx")).toContain("<QtyCell");
    expect(read("web/src/staff/Dashboard.tsx")).toContain("<QtyCell");
    expect(read("web/src/portal/screens/Orders.tsx")).toContain("qtyBreakdown(");
    expect(read("web/src/portal/screens/Cart.tsx")).toContain("qtyBreakdown(");
    expect(read("web/src/portal/screens/Products.tsx")).toContain("p.products.cartonAvail");
  });
});
