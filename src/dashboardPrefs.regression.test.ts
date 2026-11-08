import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DASHBOARD_CARD_IDS, DEFAULT_DASHBOARD_PREFS, isValidPrefsInput, normalizePrefs } from "./domain/dashboardPrefs";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("تفضيلات اللوحة (41ب)", () => {
  it("قايمة الكروت واحدة في السيرفر والواجهة", () => {
    const web = read("web/src/staff/dashboardLayout.ts");
    const ids = [...(web.match(/CARD_IDS = \[([^\]]*)\]/)?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]);
    expect(ids).toEqual([...DASHBOARD_CARD_IDS]);
  });
  it("التحقق: بيرفض المجهول والشكل الغلط وبيقبل الصحيح", () => {
    expect(isValidPrefsInput({ order: ["kpis"], hidden: [] })).toBe(true);
    expect(isValidPrefsInput({ order: ["x"], hidden: [] })).toBe(false);
    expect(isValidPrefsInput({ order: "kpis", hidden: [] })).toBe(false);
    expect(isValidPrefsInput(null)).toBe(false);
    expect(normalizePrefs(undefined)).toEqual(DEFAULT_DASHBOARD_PREFS);
  });
  it("الراوت متركّب ومحمي بتسجيل الدخول ومقيّد بمستخدم الجلسة", () => {
    expect(read("src/main.ts")).toContain("apiRouter.use(preferencesRouter)");
    const r = read("src/routes/preferences.ts");
    expect(r).toContain('router.use("/me/preferences", requireAuth)');
    expect(r).not.toMatch(/req\.(params|body|query)\.userId/);
    expect(r).toContain("req.user!.userId");
  });
  it("الهجرة 0093 بتعمل الجدول بمفتاح (مستخدم، مفتاح) وبتتمسح مع المستخدم", () => {
    const m = read("migrations/0093_user_preferences.sql");
    expect(m).toContain('PRIMARY KEY ("user_id", "key")');
    expect(m).toContain("ON DELETE CASCADE");
  });
  it("تقرير الإنتاج متاح من القايمة لمدير الإنتاج والعمليات وصفحة الويب بتقبلهم", () => {
    const web = read("web/src/staff/reportsCore.ts");
    expect(web).toContain('"production_manager"');
    expect(web).toContain('"operations_manager"');
    expect(read("src/lib/departments.ts")).toContain('label: "تقارير الإنتاج"');
  });
});
