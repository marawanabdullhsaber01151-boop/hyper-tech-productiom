/** @format */
// العطلات وإعدادات السعة (43ب): قراية الملفات كنص عشان الاختبار ميحتاجش قاعدة بيانات.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");

describe("العطلات وإعدادات السعة", () => {
  const r = read("src/routes/settings-center.ts");
  it("مسارات العطلات تحت requireAuth العام وبصلاحية الإعدادات، والكتابة بمعاملة مع تدقيق", () => {
    expect(r).toContain('router.use("/settings/center", requireAuth)');
    for (const m of ['get("/settings/center/holidays", requireSettings', 'post("/settings/center/holidays", requireSettings', 'delete("/settings/center/holidays/:id", requireSettings']) expect(r).toContain(m);
    expect(r).toContain('actionKey: "holiday.added"');
    expect(r).toContain('actionKey: "holiday.removed"');
    expect((r.match(/db\.transaction/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it("الهجرة بتعمل جدول بتاريخ فريد وفيها طريقة الرجوع", () => {
    const m = read("migrations/0096_work_holidays.sql");
    expect(m).toContain("CREATE TABLE IF NOT EXISTS \"work_holidays\"");
    expect(m).toContain("UNIQUE INDEX IF NOT EXISTS \"work_holidays_date_unique\"");
    expect(m).toContain("Rollback");
  });
  it("الإعدادين الجداد في السجل بحدودهم", () => {
    const reg = read("src/domain/settings-registry.ts");
    expect(reg).toContain('key: "capacity.cap_percent"');
    expect(reg).toContain('default: "85", min: 50, max: 100');
    expect(reg).toContain('key: "work.off_day_2"');
    expect(reg).toContain('error: "days"');
  });
  it("محمّلات السعة بتقرا الإعدادات والعطلات، والوعد كمان", () => {
    for (const f of ["src/lib/operationsCapacity.ts", "src/lib/capacityCenters.ts"]) expect(read(f)).toContain("loadCapacityConfig(now)");
    const c = read("src/lib/capacityConfig.ts");
    expect(c).toContain("capacity.cap_percent");
    expect(c).toContain("workHolidaysTable");
    expect(read("src/lib/casePromise.ts")).toContain("calendar: cap.config.calendar");
  });
});
