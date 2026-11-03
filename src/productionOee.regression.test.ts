/** @format */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const route = read("./routes/production-oee.ts");
const lib = read("./lib/oeeReport.ts");
const mig = read("../migrations/0091_machine_stoppages.sql");

describe("خطوة 37ب — سجل التوقف و OEE", () => {
  it("بدء التوقف: أدوار الكتابة، معاملة، قفل الماكينة، رفض التوقف المفتوح، تدقيق", () => {
    const i = route.indexOf('router.post("/production-oee/stoppages"');
    expect(i).toBeGreaterThan(-1);
    const h = route.slice(i, i + 3200);
    expect(h).toContain("requireRole(...STOPPAGE_WRITE_ROLES)");
    expect(h).toContain("db.transaction");
    expect(h).toContain('.for("update")');
    expect(h).toContain("isStoppageReason");
    expect(h).toContain("production.stoppage.start");
  });

  it("إنهاء التوقف: قفل الصف، المدة من السيرفر، رفض الإنهاء المكرر، تدقيق", () => {
    const i = route.indexOf('"/production-oee/stoppages/:id/end"');
    expect(i).toBeGreaterThan(-1);
    const h = route.slice(i, i + 2600);
    expect(h).toContain("db.transaction");
    expect(h).toContain('.for("update")');
    expect(h).toContain("stoppageMinutes(stop.startedAt, now)");
    expect(h).toContain("stop.endedAt");
    expect(h).toContain("production.stoppage.end");
  });

  it("القراءة بأدوار القراءة، والراوتر متركّب، ومفيش تعديل/حذف", () => {
    expect(route).toContain("requireRole(...OEE_READ_ROLES)");
    const main = read("./main.ts");
    expect(main).toContain('import productionOeeRouter from "./routes/production-oee"');
    expect(main).toContain("apiRouter.use(productionOeeRouter)");
    expect(route).not.toContain("router.delete");
    expect(route).not.toContain("router.patch");
  });

  it("التقرير: تواريخ صارمة ومدى محدود، والنقص يبقى null مش تخمين", () => {
    expect(route).toContain("isIsoDate(from)");
    expect(route).toContain("buildOeeReport");
    expect(lib).toContain("missing > 0 ? null");
    expect(lib).toContain("standardRunMinutes");
  });

  it("الترحيل: توقف مفتوح واحد لكل ماكينة + شرط هدف", () => {
    expect(mig).toContain("production_downtimes_one_open_per_machine");
    expect(mig).toContain("production_downtimes_target_chk");
  });

  it("التسجيل اليدوي دايمًا مقفول (مفيش توقف مفتوح بالغلط)", () => {
    const e = read("./routes/production-execution.ts");
    expect(e).toContain("data.minutes * 60000");
  });
});
