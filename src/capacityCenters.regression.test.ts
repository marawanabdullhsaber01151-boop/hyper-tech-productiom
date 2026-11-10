/** @format */
// خريطة السعة بمراكز العمل (43): قراية الملفات كنص عشان الاختبار ميحتاجش قاعدة بيانات.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");

describe("خريطة السعة بمراكز العمل", () => {
  it("المسار محمي بالدخول والصلاحية", () => {
    const r = read("src/routes/operations-center.ts");
    const i = r.indexOf('"/operations-center/capacity/centers"');
    expect(i).toBeGreaterThan(0);
    const block = r.slice(i, i + 260);
    expect(block).toContain("requireAuth");
    expect(block).toContain("requirePermission(OPERATIONS_MANAGER_PERMISSIONS.caseView)");
  });
  it("المحمّل بيستخدم لقطة المسار المحفوظة على الأمر والورديات النشطة، ومش بيعدّل حاجة", () => {
    const l = read("src/lib/capacityCenters.ts");
    expect(l).toContain("productionWorkflowOrdersTable.routingSnapshot");
    expect(l).toContain("foundationShiftsTable");
    expect(l).toContain("centerDailyMinutes(c.capacityMinutesPerShift, shifts.length)");
    expect(l).not.toMatch(/\.(insert|update|delete)\(/);
  });
  it("الواجهة بتنادي المسار وبتعرض النسبة كنص مع اللون", () => {
    const w = read("web/src/staff/OperationsCapacity.tsx");
    expect(w).toContain("/operations-center/capacity/centers");
    expect(w).toContain("{pct(d.load)}%");
  });
});
