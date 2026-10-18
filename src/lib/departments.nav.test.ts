/** @format */
import { describe, expect, it } from "vitest";
import { getNavForRole } from "./departments";
import { USER_ROLES } from "./roles";

/**
 * أدوار مالهاش أي قسم في القايمة دلوقتي (وحدة المشتريات اتحذفت في هجرة 0049).
 * الغلاف الجديد بيعرض لهم رسالة «مفيش أقسام متاحة لدورك». لو اتضاف لهم قسم، حدّث القايمة دي.
 */
const KNOWN_EMPTY_NAV_ROLES = ["purchasing_manager", "buyer"];

const pageIds = (role: (typeof USER_ROLES)[number]) =>
  getNavForRole(role).flatMap((d) => d.subFunctions.flatMap((s) => s.pages.map((p) => p.id)));

describe("/nav لكل دور من الـ18 (قبول المرحلة ١)", () => {
  it("كل دور بيرجّع شجرة سليمة: روابط صحيحة ومفيش صفحة مكررة جوّه نفس المحور", () => {
    for (const role of USER_ROLES) {
      const depts = getNavForRole(role);
      for (const d of depts) {
        expect(d.label.length).toBeGreaterThan(0);
        expect(d.icon.length).toBeGreaterThan(0);
        for (const s of d.subFunctions) for (const p of s.pages) expect(p.href).toMatch(/^(\/v2\/.+|[a-z0-9-]+\.html)$/);
      }
      // صفحة «المبيعات» متسجّلة عمدًا تحت محورين (أونلاين/أوفلاين) بنفس الـid، فالتكرار الممنوع جوّه نفس المحور بس.
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
});
