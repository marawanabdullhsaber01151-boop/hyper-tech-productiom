/** @format */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const route = read("./routes/activity.ts");

describe("خطوة 38أ — سجل النشاط السردي", () => {
  it("للإدارة العليا بس، على كل المسارات", () => {
    expect(route).toContain('export const ACTIVITY_ROLES = ["chairman", "executive_manager"]');
    expect((route.match(/requireRole\(\.\.\.ACTIVITY_ROLES\)/g) ?? []).length).toBe(3);
    expect(route).not.toContain("router.post");
    expect(route).not.toContain("router.delete");
    expect(route).not.toContain("router.patch");
  });

  it("الرد للعرض بس: مفيش before/after ولا IP ولا هاش", () => {
    const i = route.indexOf("const data = enriched.map");
    expect(i).toBeGreaterThan(-1);
    const h = route.slice(i, i + 700);
    expect(h).not.toContain("beforeData");
    expect(h).not.toContain("afterData");
    expect(h).not.toContain("ipAddress");
    expect(h).not.toContain("recordHash");
  });

  it("الفلاتر متحقق منها، والقسم من قايمة ثابتة، والمسار الخام بيتخبي لو له تفصيلي", () => {
    expect(route).toContain("isSectionId(q.section)");
    expect(route).toContain("isIsoDate(from)");
    expect(route).toContain("dropShadowedRows(page)");
    expect(route).toContain("starts_with(");
  });

  it("الراوتر متركّب، والصفحة في القايمة والراوت بنفس الأدوار", () => {
    const main = read("./main.ts");
    expect(main).toContain('import activityRouter from "./routes/activity"');
    expect(main).toContain("apiRouter.use(activityRouter)");
    const dep = read("./lib/departments.ts");
    expect(dep).toContain('href: "/v2/staff/activity", roles: TOP_MGMT');
  });

  it("النشطين الآن: للإدارة العليا، من الجلسات غير المقفولة، ومن غير IP أو جهاز", () => {
    const i = route.indexOf('router.get("/activity/online"');
    expect(i).toBeGreaterThan(-1);
    const h = route.slice(i, i + 1900);
    expect(h).toContain("isNull(loginSessionsTable.revokedAt)");
    expect(h).toContain("collapseOnline");
    expect(h).not.toContain("ipAddress");
    expect(h).not.toContain("deviceInfo");
    expect(h).toContain("eq(systemUsersTable.status, \"active\")");
  });
});
