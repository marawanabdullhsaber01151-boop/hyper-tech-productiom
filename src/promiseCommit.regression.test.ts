/** @format */
// تثبيت وعد التسليم (44ب): قراية الملفات كنص عشان الاختبار ميحتاجش قاعدة بيانات.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");

describe("تثبيت وعد التسليم", () => {
  const r = read("src/routes/operations-center.ts");
  const block = (path: string) => {
    const i = r.indexOf(`"${path}"`);
    expect(i).toBeGreaterThan(0);
    return r.slice(i, i + 220);
  };
  it("المسارات الأربعة محمية: التثبيت بصلاحية التعديل، والباقي بالعرض", () => {
    expect(block("/operations-center/cases/:id/promise/commit")).toContain("OPERATIONS_MANAGER_PERMISSIONS.caseEdit");
    for (const p of ["/operations-center/cases/:id/promise/history", "/operations-center/promises", "/operations-center/cases/:id/promise"]) {
      expect(block(p)).toContain("requireAuth");
      expect(block(p)).toContain("OPERATIONS_MANAGER_PERMISSIONS.caseView");
    }
  });
  it("التثبيت بمعاملة واحدة مع التدقيق، وبيرفض الحالة المقفولة والتعديل من غير سبب", () => {
    const i = r.indexOf('"/operations-center/cases/:id/promise/commit"');
    const seg = r.slice(i, i + 3200);
    expect(seg).toContain("db.transaction");
    expect(seg).toContain('"case.promise.revised"');
    expect(seg).toContain('"case.promise.committed"');
    expect(seg).toContain("isClosedCase(out.status)");
    expect(seg).toContain("REASON_REQUIRED");
  });
  it("السجل إضافة فقط: مفيش update ولا delete على جدول الوعود", () => {
    expect(r).not.toMatch(/\.(update|delete)\(operationsCasePromisesTable\)/);
    const m = read("migrations/0097_operations_case_promises.sql");
    expect(m).toContain("Rollback");
    expect(m).toContain("append-only");
  });
  it("الحساب مشترك بين العرض والتثبيت", () => {
    expect(r).toContain("computeCasePromise(id, new Date())");
    expect(read("src/lib/casePromise.ts")).toContain("export async function computeCasePromise");
  });
  it("الواجهة: تبويب الوعود وزر التثبيت", () => {
    expect(read("web/src/staff/Operations.tsx")).toContain('"promises"');
    const c = read("web/src/staff/OperationsCase.tsx");
    expect(c).toContain("/promise/commit");
    expect(c).toContain("/promise/history");
  });
});
