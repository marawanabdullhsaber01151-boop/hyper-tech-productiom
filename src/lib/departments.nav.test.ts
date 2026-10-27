/** @format */
import { describe, expect, it } from "vitest";
import { getNavForRole } from "./departments";
import { USER_ROLES } from "./roles";

/**
 * أدوار مالهاش أي قسم في القايمة. كانت purchasing_manager وbuyer (وحدة المشتريات اتحذفت في هجرة 0049)
 * واتحلّت بصفحة المخزون للقراءة فقط. أي دور جديد من غير صفحات لازم يتسجّل هنا عن قصد.
 */
const KNOWN_EMPTY_NAV_ROLES: string[] = [];

const pageIds = (role: (typeof USER_ROLES)[number]) =>
  getNavForRole(role).flatMap((d) => d.subFunctions.flatMap((s) => s.pages.map((p) => p.id)));

describe("/nav لكل دور من الـ18 (قبول المرحلة ١)", () => {
  it("كل دور بيرجّع شجرة سليمة: روابط صحيحة ومفيش صفحة مكررة جوّه نفس المحور", () => {
    for (const role of USER_ROLES) {
      const depts = getNavForRole(role);
      for (const d of depts) {
        expect(d.label.length).toBeGreaterThan(0);
        expect(d.icon.length).toBeGreaterThan(0);
        for (const s of d.subFunctions) for (const p of s.pages) expect(p.href).toMatch(/^(\/v2\/.+|[a-z0-9-]+\.html(\?channel=(website|direct))?)$/);
      }
      // صفحة المبيعات ليها مدخلين مختلفين (أونلاين/أوفلاين) بمعرّفين ورابطين مختلفين؛ التكرار الممنوع جوّه نفس المحور.
      for (const d of depts) {
        for (const s of d.subFunctions) {
          const ids = s.pages.map((p) => p.id);
          expect(new Set(ids).size).toBe(ids.length);
        }
      }
    }
  });

  it("الأدوار اللي بدون أقسام هي المعروفة بس", () => {
    const empty = USER_ROLES.filter((r) => getNavForRole(r).length === 0).sort();
    expect(empty).toEqual([...KNOWN_EMPTY_NAV_ROLES].sort());
  });

  it("رئيس مجلس الإدارة يشوف كل صفحة أي دور تاني بيشوفها", () => {
    const chairman = new Set(pageIds("chairman"));
    for (const role of USER_ROLES) {
      for (const id of pageIds(role)) expect(chairman.has(id)).toBe(true);
    }
  });

  it("المشتريات: الدورين يشوفوا الاحتياجات وأوامر الشراء، والمخزون للقراءة بس (الواجهة الجديدة)", () => {
    for (const role of ["purchasing_manager", "buyer"] as const) {
      const depts = getNavForRole(role);
      expect(depts.map((d) => d.id)).toEqual(["purchasing"]);
      expect(pageIds(role)).toEqual(["purchases", "stock-view"]);
      expect(depts[0]!.subFunctions[0]!.pages[0]!.href).toBe("/v2/staff/purchases");
      expect(depts[0]!.subFunctions[1]!.pages[0]!.href).toBe("/v2/staff/stock");
    }
  });

  it("المخازن: أمين المخزن ومديره يوصلوا لطلبات الإنتاج (قرار المخزن) في الصفحة الجديدة", () => {
    for (const role of ["storekeeper", "warehouse_manager"] as const) {
      const page = getNavForRole(role).flatMap((d) => d.subFunctions.flatMap((s) => s.pages)).find((p) => p.id === "production-requests-warehouse");
      expect(page?.href).toBe("/v2/staff/production?tab=requests");
    }
  });

  it("المخازن: أمين المخزن ومديره يشوفوا صفحة استلام أوامر الشراء", () => {
    for (const role of ["storekeeper", "warehouse_manager"] as const) expect(pageIds(role)).toContain("purchases-receive");
  });
});
