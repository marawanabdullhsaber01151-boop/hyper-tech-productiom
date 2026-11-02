/** @format */
// حراس خطوة 35: البيانات الأساسية. فحص ثابت (من غير قاعدة بيانات) لتسلسل المعاملات والتدقيق ومحاكي الأثر.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { foundationMachineSchema, foundationShiftSchema } from "../db/schema/foundation";

const source = readFileSync(resolve(process.cwd(), "src/routes/foundation.ts"), "utf8");
const impactSource = readFileSync(resolve(process.cwd(), "src/lib/foundation-impact.ts"), "utf8");
const handler = (start: string, len = 1800) => {
  const i = source.indexOf(start);
  expect(i, `${start} موجود`).toBeGreaterThan(-1);
  return source.slice(i, i + len);
};

describe("خطوة 35 — المخططات", () => {
  it("الماكينة والوردية بقى ليهم active عشان يتوقفوا", () => {
    expect(foundationMachineSchema.partial().safeParse({ active: false }).success).toBe(true);
    expect(foundationShiftSchema.partial().safeParse({ active: false }).success).toBe(true);
  });
});

describe("خطوة 35 — كل تعديل في معاملة واحدة مع التدقيق", () => {
  it.each([
    'router.post("/foundation/locations"',
    'router.patch("/foundation/locations/:id"',
    'router.post("/foundation/work-centers"',
    'router.patch("/foundation/work-centers/:id"',
    'router.post("/foundation/machines"',
    'router.patch("/foundation/machines/:id"',
    'router.patch("/foundation/machines/:id/status"',
    'router.post("/foundation/shifts"',
    'router.patch("/foundation/shifts/:id"',
    'router.post("/foundation/number-sequences"',
    'router.patch("/foundation/number-sequences/:id"',
  ])("%s", (start) => {
    const h = handler(start);
    expect(h).toContain("db.transaction");
    expect(h).toMatch(/recordAudit\(req, [^)]*\btx\)/);
  });
  it("التعديلات بتقفل الصف قبل ما تقرأه", () => {
    for (const start of ['router.patch("/foundation/locations/:id"', 'router.patch("/foundation/machines/:id"', 'router.patch("/foundation/shifts/:id"', 'router.patch("/foundation/number-sequences/:id"']) {
      expect(handler(start)).toContain('.for("update")');
    }
  });
});

describe("خطوة 35 — محاكي الأثر والعدّادات", () => {
  it("مسار الأثر موجود وللأدوار المصرّح لها ومعرّفه متفحص", () => {
    const h = handler('router.get("/foundation/impact/:kind/:id"', 700);
    expect(h).toContain("requireRole(...FOUNDATION_ROLES)");
    expect(h).toContain("parseIdParam");
  });
  it("تقاعد الماكينة بيعدّي على المحاكي", () => {
    expect(handler('router.patch("/foundation/machines/:id/status"')).toContain('status === "retired"');
  });
  it("العدّاد ما ينقصش", () => {
    const h = handler('router.patch("/foundation/number-sequences/:id"');
    expect(h).toContain("data.nextValue < Number(before.nextValue)");
    expect(h).toContain("fail(409");
  });
  it("المحاكي بيغطي مسارات التشغيل المُصدرة وآخر وردية", () => {
    expect(impactSource).toContain('"released"');
    expect(impactSource).toContain("last_shift");
    expect(impactSource).toContain("live_routing");
  });
});

describe("خطوة 35ب — الأصناف في معاملة واحدة مع التدقيق", () => {
  it.each([
    'router.post("/foundation/items"',
    'router.patch("/foundation/items/:id"',
    'router.post("/foundation/items/:id/aliases"',
    'router.delete("/foundation/items/:id/aliases/:aliasId"',
    'router.post("/foundation/items/:id/conversions"',
    'router.post("/foundation/items/:id/request-change"',
    'router.post("/foundation/items/:id/approve"',
    'router.post("/foundation/items/:id/reject"',
  ])("%s", (start) => {
    const h = handler(start, 2600);
    expect(h).toContain("db.transaction");
    expect(h).toMatch(/recordAudit\(req, [^)]*\btx\)/);
  });

  it("التعديل والاعتماد والرفض بيقفلوا الصف قبل القرار", () => {
    for (const start of ['router.patch("/foundation/items/:id"', 'router.post("/foundation/items/:id/approve"', 'router.post("/foundation/items/:id/reject"', 'router.post("/foundation/items/:id/request-change"']) {
      expect(handler(start, 2600)).toContain('.for("update")');
    }
  });

  it("طلب التغيير بيتفحص بمخطط الصنف قبل ما يتخزّن", () => {
    expect(handler('router.post("/foundation/items/:id/request-change"')).toContain("foundationItemSchema.partial()");
  });

  it("الاستيراد: بيرفض تغيير حقل حرج على صنف نشط، ومعاملة واحدة للتنفيذ", () => {
    const h = handler('router.post("/foundation/items/import"', 6000);
    expect(h).toContain("CRITICAL_FOUNDATION_ITEM_FIELDS");
    expect(h).toContain("db.transaction");
    expect(h).toContain('.for("update")');
  });
});
