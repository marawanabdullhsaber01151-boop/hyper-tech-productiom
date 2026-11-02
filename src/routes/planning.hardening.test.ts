/** @format */
// حراس خطوة 34: التخطيط. فحص ثابت لتسلسل المسارات والمعاملات والتدقيق (من غير قاعدة بيانات).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { explodePlanningSchema } from "../db/schema/planning";

const source = readFileSync(resolve(process.cwd(), "src/routes/planning.ts"), "utf8");
const handler = (start: string, len = 3200) => {
  const i = source.indexOf(start);
  expect(i, `${start} موجود`).toBeGreaterThan(-1);
  return source.slice(i, i + len);
};

describe("خطوة 34 — تحقق مدخلات الفرد", () => {
  const ok = { bomRecipeId: 1, qty: "10", requiredBy: "2026-12-01" };
  it("سطر سليم", () => expect(explodePlanningSchema.safeParse({ lines: [ok] }).success).toBe(true));
  it.each([{ qty: "0" }, { qty: "-1" }, { qty: "1.2345" }, { qty: "abc" }, { requiredBy: "01/12/2026" }, { bomRecipeId: 0 }])("مرفوض %j", (patch) => {
    expect(explodePlanningSchema.safeParse({ lines: [{ ...ok, ...patch }] }).success).toBe(false);
  });
  it("لازم سطر وأقصى 50", () => {
    expect(explodePlanningSchema.safeParse({ lines: [] }).success).toBe(false);
    expect(explodePlanningSchema.safeParse({ lines: Array.from({ length: 51 }, () => ok) }).success).toBe(false);
  });
});

describe("خطوة 34 — حراس المسارات", () => {
  it("مسار الفرد والبحث موجودين وللأدوار المخططة", () => {
    expect(handler('router.post("/planning/explode"', 300)).toContain("requireRole(...planningRoles)");
    expect(handler('router.get("/planning/lookups"', 300)).toContain("requireRole(...planningRoles)");
  });
  it("المسار القديم /planning/mrp اتشال", () => {
    expect(source).not.toContain('"/planning/mrp"');
  });
  it("طلب الشراء المفرد: معاملة + قفل + 409 + تدقيق", () => {
    const h = handler('router.post("/planning/requisitions"');
    expect(h).toContain("db.transaction");
    expect(h).toContain('.for("update")');
    expect(h).toContain("status: 409");
    expect(h).toContain("planning.requisition.create");
  });
  it("الطلبات الجماعية: لازم معتمد/مُسلَّم + قفل + تدقيق", () => {
    const h = handler('router.post("/planning/runs/:id/requisitions"', 4500);
    expect(h).toContain('run.status !== "approved" && run.status !== "released"');
    expect(h).toContain("status: 409");
    expect(h).toContain('.for("update")');
    expect(h).toContain("planning.run.requisitions");
  });
  it("الاعتماد والتسليم والإنشاء متدقّقين، والمعرّفات بتتفحص", () => {
    expect(source).toContain("planning.run.create");
    expect(source).toContain("planning.run.approve");
    expect(source).toContain("planning.run.release");
    expect(handler('router.get("/planning/runs/:id"', 300)).toContain("parseIdParam");
    expect(handler('router.post("/planning/runs/:id/approve"', 1500)).toContain("db.transaction");
  });
  it("التوريد المفتوح بيستبعد أوامر الشراء المستلمة والملغية", () => {
    const h = handler("async function loadOpenSupply", 2500);
    expect(h).toContain("received");
    expect(h).toContain("cancelled");
  });
});
