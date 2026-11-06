/** @format */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("إصلاحات صحة النظام (الجولة 3)", () => {
  it("writeAuditEvent بيفتح معاملة لو اتبعتله db نفسه (القفل الاستشاري ما بيتحررش فورًا)", () => {
    const s = src("./lib/governance.ts");
    expect(s.includes("=== db")).toBe(true);
  });
  it("مفيش مسار بيمرّر executor: db لتسجيل التدقيق", () => {
    expect(src("./routes/portal-recovery.ts").includes("executor: db")).toBe(false);
  });
  it("فشل تسجيل حدث التدقيق في mutationAudit بيتسجّل في اللوج", () => {
    expect(/logger\.error\(/.test(src("./middleware/mutationAudit.ts"))).toBe(true);
  });
  it("الإدارة العليا بتشوف كل الطلبات المعلّقة في الصندوق", () => {
    const s = src("./lib/approvalsInbox.ts");
    expect(/topManagement\s*\|\|/.test(s)).toBe(true);
  });
  it("فحوصات الاعتماد العالق وفجوة تدقيق الفواتير موجودة", () => {
    const s = src("./lib/systemHealth.ts");
    expect(s.includes('id: "orphan_approvals"')).toBe(true);
    expect(s.includes('id: "invoice_audit_gap"')).toBe(true);
  });
  it("سكربت النسخ بيجمع كل الأسرار الناقصة مرة واحدة", () => {
    const s = src("../scripts/backup/backup.sh");
    expect(s.includes("missing+=")).toBe(true);
    expect(s.includes("BACKUP_DATABASE_URL")).toBe(true);
  });
  it("سجل النشاط بيرجّع عدد المخفي عشان الشاشة تشرح ليه فاضي", () => {
    expect(src("./routes/activity.ts").includes("hidden: page.length - visible.length")).toBe(true);
  });
});
