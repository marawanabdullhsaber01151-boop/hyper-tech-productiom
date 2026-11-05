import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("مركز الإعدادات (40أ)", () => {
  it("الحفظ: معاملة واحدة + تدقيق لكل تغيير + بدون كتابة مباشرة بره المخزن", () => {
    const store = read("src/lib/settingsStore.ts");
    expect(store).toContain("db.transaction(");
    expect(store).toContain('actionKey: "setting.changed"');
    expect(store).toContain("executor: tx");
    for (const f of ["src/routes/settings.ts", "src/routes/settings-center.ts"]) {
      const s = read(f);
      expect(s.includes("insert(systemSettingsTable)")).toBe(false);
      expect(s).toContain("saveSettings(");
    }
  });
  it("المسارات مقصورة على صلاحية الإعدادات", () => {
    const r = read("src/routes/settings-center.ts");
    expect(r.match(/requireSettings/g)!.length).toBeGreaterThan(3);
    expect(read("src/main.ts")).toContain("apiRouter.use(settingsCenterRouter)");
  });
  it("المستهلكون بيقروا الإعدادات الفعلية مش الثوابت", () => {
    const inbox = read("src/lib/approvalsInbox.ts");
    expect(inbox).toContain("loadOperationalConfig()");
    expect(inbox).toContain("cfg.slaMinutes");
    expect(inbox).toContain("cfg.work");
    expect(inbox.includes("SLA_WORKING_MINUTES")).toBe(false);
    expect(read("src/lib/productionOversight.ts")).toContain("stallFactor");
  });
  it("الإعدادات في القايمة: ساعات العمل ومهلة الاعتماد وحساسية الوقوف", () => {
    const reg = read("src/domain/settings-registry.ts");
    for (const k of ["work.start_hour", "work.end_hour", "work.off_day", "approval.sla_hours", "stall.percent"]) expect(reg).toContain(`"${k}"`);
  });
  it("القايمة بتودّي لصفحة الإعدادات الجديدة", () => {
    expect(read("src/lib/departments.ts")).toContain('href: "/v2/staff/settings"');
  });
});
