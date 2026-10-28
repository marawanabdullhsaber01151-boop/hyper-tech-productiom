/** @format */
/**
 * الخطوة 23: «أوامر الإنتاج» و«لوحة مدير الإنتاج» بقوا تبويب `orders` في صفحة الإنتاج الموحّدة.
 * الاختبار ده بيمسك: حذف الصفحات القديمة، التحويلات، حراس الأدوار في السيرفر، وتطابق أدوار الويب مع السيرفر.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCESS } from "./lib/accessRegistry";
import { getNavForRole } from "./lib/departments";
import { PRODUCTION_PAGE_REDIRECTS } from "./lib/legacyRedirects";

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const roleList = (src: string, name: string): string[] => {
  const m = src.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\]`));
  if (!m) throw new Error(`مش لاقي ${name}`);
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
};

describe("تبويب أوامر الإنتاج الموحّد", () => {
  it("الصفحات والسكربتات القديمة اتمسحت", () => {
    for (const f of ["public/production.html", "public/JS/production.js", "public/JS/factory-control-tower.js", "public/factory-production-manager.html", "public/JS/factory-production-manager.js", "public/factory-supervisor.html", "public/JS/factory-supervisor.js", "public/factory-quality-controller.html", "public/JS/factory-quality-controller.js"]) {
      expect(existsSync(resolve(root, f))).toBe(false);
    }
  });

  it("الروابط القديمة بتتحوّل لتبويب الأوامر", () => {
    expect(PRODUCTION_PAGE_REDIRECTS["/production.html"]).toBe("/v2/staff/production?tab=orders");
    expect(PRODUCTION_PAGE_REDIRECTS["/factory-supervisor.html"]).toBe("/v2/staff/production?tab=orders");
    expect(PRODUCTION_PAGE_REDIRECTS["/factory-production-manager.html"]).toBe("/v2/staff/production?tab=orders");
  });

  it("القايمة فيها صفحة واحدة للأوامر ومفيش روابط للـ html القديم", () => {
    const hrefs = getNavForRole("production_manager").flatMap((d) => d.subFunctions.flatMap((s) => s.pages.map((p) => p.href)));
    expect(hrefs).toContain("/v2/staff/production?tab=orders");
    expect(hrefs).not.toContain("production.html");
    expect(hrefs).not.toContain("factory-production-manager.html");
  });

  it("سكربت الدخول القديم ما بيوجّهش لصفحات اتمسحت", () => {
    const src = read("public/JS/enhancements.js");
    expect(src).not.toContain("factory-supervisor.html");
    expect(src).not.toContain('"production.html"');
    expect(src).not.toContain('"factory-production-manager.html"');
  });

  it("دورة حياة الأمر وتفاصيله مقفولة بنفس أدوار القايمة، وبيانات العميل بتتخفي", () => {
    const life = read("src/routes/production-lifecycle.ts");
    expect(life).toContain('"/production-workflow/:id/lifecycle",\n  requireAuth,\n  requireRole(...ACCESS.productionWorkflowRead)');
    expect(life).toContain("maskProductionWorkflowPayload");
    const wf = read("src/routes/production-workflow.ts");
    expect(wf).toContain('"/production-workflow/:id",\n  requireAuth,\n  // نفس أدوار القايمة بالظبط');
    expect(wf).toContain("requireRole(...ACCESS.productionWorkflowRead)");
  });

  it("مدير المبيعات والاتش آر بيشوفوا متابعة الإنتاج من قسم المبيعات (والإدارة العليا من قسم الإنتاج)", () => {
    for (const role of ["sales_manager", "hr", "hr_manager"] as const) {
      const hrefs = getNavForRole(role).flatMap((d) => d.subFunctions.flatMap((s) => s.pages.map((p) => p.href)));
      expect(hrefs).toContain("/v2/staff/production?tab=orders");
    }
    expect((ACCESS.productionWorkflowRead as readonly string[]).includes("sales_manager")).toBe(true);
  });

  it("مسار الوصفات مسجّل قبل /:id (وإلا Express يفسّره id)", () => {
    const wf = read("src/routes/production-workflow.ts");
    expect(wf.indexOf('"/production-workflow/recipes"')).toBeGreaterThan(0);
    expect(wf.indexOf('"/production-workflow/recipes"')).toBeLessThan(wf.indexOf('router.get(\n  "/production-workflow/:id"'));
  });

  it("أدوار الويب للأوامر مطابقة للسيرفر", () => {
    const web = read("web/src/staff/orderRules.ts");
    expect(roleList(web, "ORDER_VIEW_ROLES").sort()).toEqual([...ACCESS.productionWorkflowRead].sort());
    const wf = read("src/routes/production-workflow.ts");
    const guard = (route: string) => {
      const i = wf.indexOf(`"/production-workflow/${route}"`);
      const m = wf.slice(i, i + 400).match(/requireRole\(([^)]*)\)/);
      return [...(m?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1]!).sort();
    };
    expect(roleList(web, "ORDER_RECEIVE_ROLES").sort()).toEqual(guard(":id/receive"));
    expect(roleList(web, "DISPATCH_ROLES").sort()).toEqual(guard(":id/dispatch"));
    expect(roleList(web, "ADVANCE_ROLES").sort()).toEqual(guard(":id/advance-stage"));
  });
});

describe("فحص الجودة (الخطوة 25)", () => {
  it("لوحة مراقب الجودة القديمة بتتحوّل لتبويب الفحص، والقايمة بتشاور عليه", () => {
    expect(PRODUCTION_PAGE_REDIRECTS["/factory-quality-controller.html"]).toBe("/v2/staff/production?tab=inspect");
    for (const role of ["production_quality_controller", "quality_engineer", "raw_material_quality_controller"] as const) {
      const hrefs = getNavForRole(role).flatMap((d) => d.subFunctions.flatMap((s) => s.pages.map((p) => p.href)));
      expect(hrefs).toContain("/v2/staff/production?tab=inspect");
    }
  });

  it("قرار الجودة في السيرفر: أدوار بدون المشرف + فحص القواعد + تدقيق", () => {
    const wf = read("src/routes/production-workflow.ts");
    const i = wf.indexOf('"/production-workflow/:id/quality-done"');
    expect(wf.slice(i, i + 300)).toContain("requireRole(...QUALITY_DECIDE_ROLES)");
    expect(wf).toContain("checkQualityDone(data)");
    expect(wf).toContain('actionKey: "production.quality.decision"');
    const core = read("src/lib/productionQualityCore.ts");
    const m = core.match(/QUALITY_DECIDE_ROLES = \[([^\]]*)\]/)!;
    expect(m[1]).not.toContain("supervisor");
  });

  it("أدوار قرار الجودة في الويب مطابقة للسيرفر", () => {
    const pick = (src: string, name: string) => [...src.match(new RegExp(`${name} = \\[([^\\]]*)\\]`))![1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!).sort();
    expect(pick(read("web/src/staff/qualityRules.ts"), "QUALITY_DECIDE_ROLES")).toEqual(pick(read("src/lib/productionQualityCore.ts"), "QUALITY_DECIDE_ROLES"));
  });
});
