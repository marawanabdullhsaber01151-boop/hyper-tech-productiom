import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

describe("الحوكمة بعد 39ب", () => {
  it("الصفحة القديمة وملفاتها اتمسحت وبتتحوّل لصفحة الاعتمادات", () => {
    for (const f of ["public/governance.html", "public/JS/governance.js", "public/CSS/governance.css"]) expect(existsSync(resolve(root, f))).toBe(false);
    expect(read("src/main.ts")).toContain("app.get(LEGACY_GOVERNANCE_PATH");
    expect(read("src/lib/legacyRedirects.ts")).toContain('GOVERNANCE_REDIRECT_TARGET = "/v2/staff/approvals"');
  });
  it("القايمة مفيهاش رابط governance.html", () => {
    expect(read("src/lib/departments.ts")).not.toContain("governance.html");
  });
  it("التفويضات والسياسات: الكتابة والتدقيق في معاملة واحدة (ADR 0008)", () => {
    const g = read("src/routes/governance.ts");
    for (const marker of ["tx.insert(delegationsTable)", "tx.update(delegationsTable)", "tx.insert(approvalPoliciesTable)", "tx.update(approvalPoliciesTable)"]) expect(g).toContain(marker);
    expect(g).not.toContain("await db.insert(delegationsTable)");
    expect(g).not.toContain("await db.update(approvalPoliciesTable)");
  });
  it("قوايم الاختيار متاحة للرئيس والمدير التنفيذي، والمحاكاة وفحص السلسلة للرئيس فقط", () => {
    const g = read("src/routes/governance.ts");
    expect(g).toContain('router.get("/governance/roles", requireRole("chairman", "executive_manager")');
    expect(g).toContain('router.get("/governance/actions", requireRole("chairman", "executive_manager")');
    expect(g).toContain('router.get("/governance/simulate", requireRole("chairman")');
    expect(g).toContain('router.get("/governance/audit-events/verify", requireRole("chairman")');
  });
  it("الواجهة بتعرض تبويبات الإدارة حسب الدور", () => {
    const a = read("web/src/staff/Approvals.tsx");
    expect(a).toContain("canManageDelegations(role)");
    expect(a).toContain("canEditGovernance(role)");
  });
});
