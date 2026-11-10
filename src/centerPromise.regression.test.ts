/** @format */
// وعد التسليم من المسار ومسار الأوامر من غير لقطة (43ج): قراية الملفات كنص عشان الاختبار ميحتاجش قاعدة بيانات.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");

describe("مسار التصنيع للسعة والوعد", () => {
  it("الأوامر من غير لقطة مسار بتاخد مسار المنتج المعتمد الحالي (قراية فقط)", () => {
    const l = read("src/lib/capacityCenters.ts");
    expect(l).toContain("loadRecipeRoutings(needLive, today)");
    expect(l).toContain("liveRoutingOrders");
    expect(l).not.toMatch(/\.(insert|update|delete)\(/);
    const r = read("src/lib/routingResolve.ts");
    expect(r).toContain("foundationItemId");
    expect(r).not.toMatch(/\.(insert|update|delete)\(/);
  });
  it("وعد الحالة بيجرّب المسار الأول وبيرجع لمدة الوصفة لو ناقص، ويقول الطريقة", () => {
    const o = read("src/lib/casePromise.ts");
    expect(o).toContain("simulatePromise({");
    expect(o).toContain("const promise = sim ?");
    expect(o).toContain('method: sim ? "simulation" : "days"');
    expect(read("src/routes/operations-center.ts")).toContain("computeCasePromise(id, new Date())");
  });
  it("الواجهة بتعرض طريقة الحساب", () => {
    expect(read("web/src/staff/OperationsCase.tsx")).toContain('p.method === "simulation"');
    expect(read("web/src/copy/operations.ts")).toContain("opc.pr.bySim");
  });
});
