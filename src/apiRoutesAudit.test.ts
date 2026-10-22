import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("الخطوة 8 — مسارات الـAPI القديمة اتشالت وماحدش رجّعها", () => {
  it("مفيش مسار بلا مستهلك وبلا تصنيف في docs/api-routes-allowlist.json", () => {
    expect(() => execFileSync("node", ["scripts/api-consumers.mjs", "--check"], { stdio: "pipe" })).not.toThrow();
  }, 60_000); // الجرد بيقرا الشجرة كلها، وبيبطّأ لما الاختبارات تشتغل بالتوازي

  it("نظام استرجاع كلمة السر القديم (OTP + طابور الطلبات اليدوي) اتشال", () => {
    const portal = read("src/routes/portal.ts");
    expect(portal).not.toMatch(/\/portal\/forgot-password/);
    expect(portal).not.toMatch(/router\.post\(\s*"\/portal\/otp\//);
    const admin = read("src/routes/portal-customers-admin.ts");
    expect(admin).not.toMatch(/password-reset-requests/);
    expect(admin).not.toMatch(/"\/portal-customers\/:id\/reset-password"/);
    expect(admin).not.toMatch(/"\/portal-applications\/:id\/needs-info"/);
    expect(read("src/routes/portal-recovery.ts")).not.toMatch(/use-recovery-code"/);
    expect(read("src/routes/portal-companies-admin.ts")).not.toMatch(/"\/portal-settings"/);
  });

  it("الاسترجاع الوحيد المتاح هو /portal/recovery/* والتسجيل المباشر لسه 410", () => {
    const rec = read("src/routes/portal-recovery.ts");
    expect(rec).toContain('"/portal/recovery/verify"');
    expect(rec).toContain('"/portal/recovery/complete"');
    expect(read("src/routes/portal.ts")).toContain("PORTAL_SELF_REGISTRATION_DISABLED");
  });
});
