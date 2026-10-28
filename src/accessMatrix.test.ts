/** @format */
/**
 * مصفوفة الوصول: القايمة ↔ حارس الصفحة ↔ بيانات الصفحة.
 * بتمنع المشكلة اللي كانت بتطلّع «تعذّر تحميل بيانات» لأي دور غير الرئيس: صفحة ظاهرة للدور في القايمة
 * لكن الحارس أو الـAPI بتاعها بيرفضوه.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCESS, capabilitiesFor, type AccessKey } from "./lib/accessRegistry";
import { getNavForRole } from "./lib/departments";
import { USER_ROLES } from "./lib/roles";

const root = process.cwd();
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

const legacyPages = (role: string) =>
  [...new Set(getNavForRole(role as (typeof USER_ROLES)[number]).flatMap((d) => d.subFunctions.flatMap((s) => s.pages.map((p) => p.href.split("?")[0] as string))))].filter((h) =>
    h.endsWith(".html"),
  );

describe("القايمة ↔ حارس الصفحة", () => {
  it("كل صفحة قديمة ظاهرة للدور في القايمة: الملف موجود، وحارس الصفحة (data-allowed-roles) بيسمح له", () => {
    const bad: string[] = [];
    for (const role of USER_ROLES) {
      for (const href of legacyPages(role)) {
        const file = `public/${href.replace(/^\//, "")}`;
        if (!existsSync(resolve(root, file))) {
          bad.push(`${role}: ${href} (الملف مش موجود)`);
          continue;
        }
        const attr = read(file).match(/data-allowed-roles="([^"]*)"/)?.[1];
        if (attr !== undefined && !attr.split(",").map((s) => s.trim()).includes(role)) bad.push(`${role}: ${href} (الحارس بيرفضه)`);
      }
    }
    expect(bad).toEqual([]);
  });
});

/** صفحات أساسية: لو الصفحة دي ظاهرة لدور، المفتاح ده لازم يسمح له (وإلا الصفحة بتفشل في التحميل). */
const CRITICAL_LOADS: Array<{ page: string; access: AccessKey; why: string }> = [
  { page: "factory-warehouse-manager.html", access: "productionWorkflowRead", why: "قايمة أوامر المخزن" },
  { page: "factory-intake.html", access: "productionWorkflowRead", why: "قايمة أوامر الاستقبال" },
];

describe("الصفحات الأساسية وبياناتها", () => {
  for (const c of CRITICAL_LOADS) {
    it(`${c.page}: كل دور بيشوفها يقدر يقرا (${c.why})`, () => {
      const blocked = USER_ROLES.filter(
        (role) => role !== "chairman" && legacyPages(role).includes(c.page) && !(ACCESS[c.access] as readonly string[]).includes(role),
      );
      expect(blocked).toEqual([]);
    });
  }
});

describe("capabilitiesFor + /me/access", () => {
  it("رئيس المجلس يقدر على كله، وأدوار المبيعات تقرا المخزون بس", () => {
    expect(Object.values(capabilitiesFor("chairman")).every(Boolean)).toBe(true);
    const sales = capabilitiesFor("online_seller");
    expect(sales.inventoryRead).toBe(true);
    expect(sales.dashboardRead).toBe(false);
    expect(sales.productionWorkflowRead).toBe(false);
    expect(capabilitiesFor("unknown_role").inventoryRead).toBe(false);
  });

  it("الراوتات بتقرا من السجل (مش قوايم نصية متكررة)", () => {
    expect(read("src/routes/inventory.ts").match(/ACCESS\.inventoryRead/g)?.length).toBe(2);
    expect(read("src/routes/production-workflow.ts")).toContain("ACCESS.productionWorkflowRead");
    expect(read("src/routes/dashboard.ts")).toContain("ACCESS.dashboardRead");
    expect(read("src/routes/production-cycle.ts")).toContain("ACCESS.productionCycleRead");
    expect(read("src/main.ts")).toContain("apiRouter.use(accessRouter)");
    expect(read("src/routes/access.ts")).toContain('"/me/access"');
  });

  it("الأدوار اللي اتضافت لقراءة أوامر الإنتاج بيتخفى عنهم بيانات العميل (زي أدوار الأرضية)", () => {
    const masking = read("src/lib/fieldMasking.ts");
    const set = masking.slice(masking.indexOf("FACTORY_FLOOR_ROLES"), masking.indexOf("]);"));
    for (const role of ["quality_engineer", "raw_material_quality_controller", "production_quality_controller"]) {
      expect(set).toContain(`"${role}"`);
    }
  });

  it("لوحة التحكم (v2) بتحمّل المصادر المسموحة بس", () => {
    const dash = read("web/src/staff/Dashboard.tsx");
    expect(dash).toContain('"/me/access"');
    expect(dash).toContain('may("productionWorkflowRead")');
    expect(dash).toContain('may("inventoryRead")');
    expect(dash).toContain('may("dashboardRead")');
  });
});
