/** @format */
// كشف الحساب وأعمار الديون (51): قراية بس، للإدارة العليا، ومفيش أي كتابة. قراية الملفات كنص عشان الاختبار ميحتاجش قاعدة بيانات.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");

describe("كشف الحساب والأعمار: المسارات", () => {
  const r = read("src/routes/receivables.ts");
  it("قراية بس: GET للإدارة العليا (finance.view) ومفيش أي كتابة", () => {
    expect(r).toContain("requireRole(...PERMISSIONS.finance.view)");
    expect(r).not.toContain("PERMISSIONS.finance.write");
    expect(r).not.toMatch(/router\.(post|put|patch|delete)\(/);
    expect(r.match(/router\.get\(/g)?.length).toBe(2);
  });
  it("التواريخ بتتفحص بـisIsoDate (مش Date.parse اللي بيقبل 30 فبراير) والمدى بيتراجع", () => {
    expect(r).toContain("isIsoDate");
    expect(r).toContain("BAD_RANGE");
  });
  it("الاستعلامات مفيهاش أي تعديل على قاعدة البيانات", () => {
    const l = read("src/lib/receivables.ts");
    expect(l).not.toMatch(/\b(insert|update|delete)\s+(into|from)?\s*(sales_orders|customer_payments|payment_allocations|gl_)/i);
  });
  it("مركّب في التطبيق، وليه تبويب في الحسابات", () => {
    expect(read("src/main.ts")).toContain("apiRouter.use(receivablesRouter)");
    expect(read("web/src/staff/Ledger.tsx")).toContain("<Receivables />");
  });
  it("الفاتورة المفتوحة بنفس تعريف التحصيلات: مؤكد/مشحون والتحصيلات السارية بس", () => {
    const l = read("src/lib/receivables.ts");
    expect(l).toContain("status in ('confirmed','shipped')");
    expect(l).toContain("p.status = 'posted'");
  });
});
