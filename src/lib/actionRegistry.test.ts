/** @format */

import { describe, it, expect } from "vitest";
import { ACTION_REGISTRY, findAction } from "./actionRegistry";
import { PERMISSIONS } from "./permissions";

/**
 * ✅ الاختبارات دي بتؤتمت بالظبط نفس الفحص اليدوي اللي لازم يتعمل كل مرة
 * حد يعدّل في actionRegistry.ts أو permissions.ts: هل defaultRoles لكل
 * إجراء لسه مطابقة لمصفوفة PERMISSIONS الأصلية؟ ده نفس نوع البغّ اللي
 * smoke-test.js بيوصفه في تعليقه (بغّ #6: "أدوار افتراضية في actionRegistry
 * ما بتطابقش requireRole الأصلي") — هنا بنتأكد منه آليًا مع كل تشغيل.
 *
 * الخريطة تحت بتربط كل مجموعة إجراءات (create/edit/delete) بمورد
 * PERMISSIONS المقابل لها. لو حد ضاف إجراء جديد من غير ما يحدّث الخريطة
 * دي، الاختبار الأخير في الملف هيفشل ويفكّره.
 */
// ✅ إصلاح: بعض موارد PERMISSIONS (مثل "reports") عندها view بس من غير write،
// فاستخدام `keyof typeof PERMISSIONS` هنا كان يخلّي TypeScript يحسب النوع
// كـ union لكل الموارد الممكنة (بما فيهم اللي مالهاش write) ويرفض البناء،
// رغم إن "reports" أصلاً مش من ضمن القيم المستخدمة تحت. النوع ده بيقصر
// الاختيار فعليًا على الموارد اللي عندها write بس — تصحيح دقيق للنوع
// بدل ما نوسّعه بشكل مضلّل (كإضافة write: [] وهمية لـ reports).
type WritablePermissionResource = {
  [K in keyof typeof PERMISSIONS]: "write" extends (
    keyof (typeof PERMISSIONS)[K]
  ) ?
    K
  : never;
}[keyof typeof PERMISSIONS];

const GROUP_TO_PERMISSION_RESOURCE: Record<string, WritablePermissionResource> =
  {
    "جهات الاتصال": "contacts",
    المبيعات: "sales",
    المشتريات: "purchases",
    المخزون: "inventory", // ⚠️ ملاحظة: movements.* بيتفحص لوحده تحت لأنه مورد مختلف
    "وصفات التصنيع": "bom",
    "الموارد البشرية": "hr",
    المحاسبة: "accounting",
  };

describe("actionRegistry — تطابق الأدوار الافتراضية مع PERMISSIONS", () => {
  it("كل مفتاح إجراء فريد (مفيش تكرار)", () => {
    const keys = ACTION_REGISTRY.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("كل إجراء عنده defaultRoles غير فاضية", () => {
    for (const action of ACTION_REGISTRY) {
      expect(action.defaultRoles.length).toBeGreaterThan(0);
    }
  });

  it("findAction بترجع الإجراء الصح وundefined للمفتاح الغلط", () => {
    expect(findAction("contacts.create")?.label).toBe("إضافة جهة اتصال");
    expect(findAction("not.a.real.key")).toBeUndefined();
  });

  for (const [group, resource] of Object.entries(
    GROUP_TO_PERMISSION_RESOURCE,
  )) {
    it(`مجموعة "${group}" — defaultRoles مطابقة تمامًا لـ PERMISSIONS.${String(resource)}.write`, () => {
      const expected = [...PERMISSIONS[resource].write].sort();
      // ⚠️ مجموعة "المخزون" فيها inventory.* و movements.* مع بعض، لكن كل
      // واحد منهم مصدر PERMISSIONS مختلف — movements.* بيتفحص لوحده في
      // الاختبار اللي بعد ده، فمنستبعدهم هنا عشان الفحص يبقى دقيق ومقصود
      // مش نجاح بالصدفة لأن القيمتين متطابقين حاليًا.
      const actionsInGroup = ACTION_REGISTRY.filter(
        (a) => a.group === group && !a.key.startsWith("movements."),
      );
      expect(actionsInGroup.length).toBeGreaterThan(0); // تأكد إن الخريطة نفسها لسه صحيحة
      for (const action of actionsInGroup) {
        expect([...action.defaultRoles].sort()).toEqual(expected);
      }
    });
  }

  it("مجموعة المخزون: إجراءات movements.* مطابقة لـ PERMISSIONS.movements.write", () => {
    const expected = [...PERMISSIONS.movements.write].sort();
    const movementActions = ACTION_REGISTRY.filter((a) =>
      a.key.startsWith("movements."),
    );
    expect(movementActions.length).toBeGreaterThan(0);
    for (const action of movementActions) {
      expect([...action.defaultRoles].sort()).toEqual(expected);
    }
  });

  it("كل إجراء في actionRegistry ينتمي لمجموعة معروفة (مفيش مجموعة يتيمة من غير خريطة)", () => {
    const knownGroups = new Set([
      ...Object.keys(GROUP_TO_PERMISSION_RESOURCE),
      "دورة الإنتاج",
      // ✅ إضافة: مجموعتان جديدتان شرعيتان جايين من وحدة العمليات
      // التشغيلية (operations.ts) — تسجيل تكلفة إنتاج وإغلاق استثناءات
      // تشغيلية، منطقيًا منفصلين عن "دورة الإنتاج" العامة
      "التكلفة الصناعية",
      "الاستثناءات",
      "Operations Control",
      "الإعدادات",
    ]);
    for (const action of ACTION_REGISTRY) {
      expect(knownGroups.has(action.group)).toBe(true);
    }
  });
});
