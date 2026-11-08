import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REPORT_ROLES } from "./domain/reports";
import { getNavForRole } from "./lib/departments";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("التقارير (41أ)", () => {
  it("الراوت متركّب ومحمي بتسجيل الدخول وفحص دور كل تقرير", () => {
    expect(read("src/main.ts")).toContain("apiRouter.use(reportsRouter)");
    const r = read("src/routes/reports.ts");
    expect(r).toContain('router.use("/reports", requireAuth)');
    expect(r).toContain("REPORT_ROLES[id].includes(req.user!.role)");
  });
  it("كل تصدير بيتسجّل في سجل التدقيق", () => {
    const r = read("src/routes/reports.ts");
    expect(r).toContain('actionKey: "reports.export"');
    expect(r.indexOf("writeAuditEvent(")).toBeLessThan(r.indexOf("buildXlsx("));
  });
  it("المبالغ بالقروش: مفيش parseFloat/Number لجمع مبالغ في حسابات التقارير", () => {
    const d = read("src/domain/reports.ts");
    expect(d).not.toContain("parseFloat");
    expect(d).toContain("centsToString");
    expect(d).toContain("lineTotalCents");
  });
  it("صفحة الويب متاحة لنفس أدوار التقارير والإدارة العليا بتلاقيها في القايمة", () => {
    const web = read("web/src/staff/reportsCore.ts");
    for (const role of new Set(Object.values(REPORT_ROLES).flat())) expect(web, role).toContain(`"${role}"`);
    const nav = getNavForRole("chairman").flatMap((d) => d.subFunctions.flatMap((s) => s.pages.map((p) => p.href)));
    expect(nav).toContain("/v2/staff/reports");
    expect(getNavForRole("executive_manager").flatMap((d) => d.subFunctions.flatMap((s) => s.pages.map((p) => p.href)))).toContain("/v2/staff/reports");
  });
  it("الويب بيقرا القايمة والتقرير من غير {data:} (شكل الرد)", () => {
    const s = read("web/src/staff/Reports.tsx");
    expect(s).not.toMatch(/api\.(get|post)<\{\s*data:/);
    expect(s).toContain('api.get<ReportMeta[]>("/reports"');
  });
});
