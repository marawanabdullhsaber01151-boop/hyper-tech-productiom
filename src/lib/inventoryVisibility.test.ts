/** @format */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { maskFields } from "./fieldMasking";
import { PERMISSIONS } from "./permissions";

const sample = { id: 1, name: "خامة", qty: "5", unitPrice: "12.50", supplierId: 9 };
const seen = (role: string) => maskFields("inventory_items", sample, role) as Record<string, unknown>;

describe("إخفاء حقول المخزون حسب الدور", () => {
  it("سعر الوحدة: للإدارة والمخازن والموارد بس", () => {
    for (const role of ["chairman", "executive_manager", "hr", "hr_manager", "warehouse_manager", "storekeeper"]) {
      expect(seen(role).unitPrice).toBe("12.50");
    }
    for (const role of ["purchasing_manager", "buyer", "production_manager", "production_controller", "operations_manager", "raw_material_quality_controller"]) {
      expect("unitPrice" in seen(role)).toBe(false);
    }
  });

  it("المورّد: المشتريات وأمين المخزن يشوفوه، والإنتاج والعمليات لأ", () => {
    for (const role of ["purchasing_manager", "buyer", "storekeeper", "warehouse_manager"]) expect(seen(role).supplierId).toBe(9);
    for (const role of ["production_manager", "operations_manager", "raw_material_quality_controller"]) {
      expect("supplierId" in seen(role)).toBe(false);
    }
  });

  it("المشتريات: عرض المخزون مسموح، والكتابة لأ", () => {
    for (const role of ["purchasing_manager", "buyer"]) {
      expect((PERMISSIONS.inventory.view as readonly string[]).includes(role)).toBe(true);
      expect((PERMISSIONS.inventory.write as readonly string[]).includes(role)).toBe(false);
    }
  });

  it("كل دور بيشوف المخزون: الحقول الأساسية (الاسم والكمية) دايمًا موجودة بعد الإخفاء", () => {
    for (const role of PERMISSIONS.inventory.view) {
      const row = seen(role);
      expect(row.name).toBe("خامة");
      expect(row.qty).toBe("5");
    }
  });

  it("الراوت بيطبّق السياسة فعلًا في القايمة وفي صنف واحد (كانت معرّفة ومش متطبّقة)", () => {
    const src = readFileSync(resolve(process.cwd(), "src/routes/inventory.ts"), "utf8");
    expect(src.match(/maskFields\("inventory_items"/g)?.length).toBe(2);
    expect(src).toContain('import { maskFields } from "../lib/fieldMasking"');
  });
});
