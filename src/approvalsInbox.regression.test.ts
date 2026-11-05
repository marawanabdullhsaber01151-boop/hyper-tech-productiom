/** @format */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const gov = read("./routes/governance.ts");
const route = read("./routes/approvals.ts");
const lib = read("./lib/approvalsInbox.ts");

describe("خطوة 39أ — صندوق الاعتمادات", () => {
  it("القرار: دور الخطوة، المنشئ ما يعتمدش نفسه، الرفض بسبب، التدقيق في نفس المعاملة", () => {
    const i = gov.indexOf('"/governance/approval-requests/:id/decide"');
    expect(i).toBeGreaterThan(-1);
    const h = gov.slice(i, i + 9000);
    expect(h).toContain("decideVerdict(");
    expect(h).toContain("rejected_self_approval");
    expect(h).toContain("rejectNoteError(decision.note)");
    expect(h).toContain("executor: tx");
    // مفيش تدقيق للقرار بعد المعاملة
    const after = h.slice(h.indexOf("return updatedRequest;"));
    expect(after.slice(0, 200)).not.toContain("writeAuditEvent");
  });

  it("الصندوق قراءة فقط ومحمي بأدوار المعتمدين، والراوتر متركّب", () => {
    expect(route).toContain("requireRole(...APPROVER_ROLES)");
    expect(route).not.toContain("router.post");
    expect(route).not.toContain("router.patch");
    const main = read("./main.ts");
    expect(main).toContain('import approvalsRouter from "./routes/approvals"');
    expect(main).toContain("apiRouter.use(approvalsRouter)");
  });

  it("مسح المهلة: على عامل الـ15 دقيقة، بمفتاح منع تكرار ومهمة للإدارة العليا، وبيقفل مهام الطلبات المقفولة", () => {
    const h = read("./routes/health.ts");
    expect(h).toContain("scanApprovalSla().catch(() => null)");
    expect(lib).toContain("dedupeKey: slaDedupeKey(");
    expect(lib).toContain("cfg.slaMinutes");
    expect(lib).toContain("a.status <> 'pending'");
    expect(lib).toContain('assigneeRole: roleOf.get(r.requestedBy) === "chairman" ? "executive_manager" : "chairman"');
  });

  it("صفحة الصندوق في القايمة بنفس الأدوار", () => {
    const d = read("./lib/departments.ts");
    expect(d).toContain('href: "/v2/staff/approvals", roles: APPROVERS');
  });
});
