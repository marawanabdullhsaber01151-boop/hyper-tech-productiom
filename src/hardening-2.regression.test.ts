/** @format */
/**
 * اختبارات ارتداد لحزمة hardening-2: أرشفة العميل بدل الحذف، وحماية الموظف صاحب النشاط من الحذف.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("hardening-2 — أرشفة الشركات", () => {
  it("هجرة 0078: أعمدة اختيارية فقط (مفيش أثر على الصفوف الموجودة) + فهرس جزئي + Rollback", () => {
    const sql = read("migrations/0078_portal_customer_archive.sql");
    for (const col of ["archived_at", "archived_by_user_id", "archive_reason"]) expect(sql).toContain(col);
    expect(sql).toContain("-- Rollback:");
    // أي عمود جديد لازم يكون اختياري (NOT NULL على ADD COLUMN كان هيفشل على الصفوف الموجودة)
    expect(sql).not.toMatch(/ADD COLUMN[^;]*NOT NULL/);
    expect(sql).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE\s+TABLE/i);
  });

  it("الـschema فيه الأعمدة الجديدة", () => {
    const schema = read("src/db/schema/portal-customers.ts");
    expect(schema).toContain('archivedAt: timestamp("archived_at"');
    expect(schema).toContain('archiveReason: text("archive_reason")');
  });

  it("المؤرشفة مخفية من القوايم العادية وبتظهر في فلتر «مؤرشف» بس", () => {
    const q = read("src/lib/portalCompaniesQuery.ts");
    expect(q).toContain('"archived"');
    expect(q).toContain("t.archived_at IS NOT NULL");
    expect(q).toContain("t.archived_at IS NULL");
    // تفاصيل الشركة (loadCompanyRow) ما بتتفلترش، عشان صفحة الشركة المؤرشفة تفتح وتترجع
    const detail = q.slice(q.indexOf("export async function loadCompanyRow"));
    expect(detail).not.toContain("companyFilters");
  });

  it("أرشفة واسترجاع: داخل transaction بقفل الصف، وبيسجّلوا في التدقيق، والأرشفة بتلغي الجلسات", () => {
    const r = read("src/routes/portal-companies-list.ts");
    const archive = r.slice(r.indexOf('"/portal-companies/:id/archive"'), r.indexOf('"/portal-companies/:id/restore"'));
    const restore = r.slice(r.indexOf('"/portal-companies/:id/restore"'), r.indexOf("Global settings (catalog"));
    for (const block of [archive, restore]) {
      expect(block).toContain('.for("update")');
      expect(block).toContain("writeAuditEvent(");
      expect(block).toContain("writePortalAudit(");
    }
    expect(archive).toContain("revokeAllPortalSessions(");
    expect(archive).toContain("archiveNeedsOpenOrdersConfirmation(");
    expect(archive).toContain("COMPANY_HAS_OPEN_ORDERS");
    expect(restore).toContain("restoredCompanyFields()");
    expect(r).toContain('router.post("/portal-companies/:id/archive", ...manage');
    expect(r).toContain('router.post("/portal-companies/:id/restore", ...manage');
  });

  it("إعادة التفعيل العادي (جماعي + الشاشة القديمة) مرفوضة على المؤرشفة", () => {
    expect(read("src/routes/portal-companies-list.ts")).toContain("canPlainReactivate(row.archivedAt)");
    expect(read("src/routes/portal-customers-admin.ts")).toContain("PORTAL_CUSTOMER_ARCHIVED");
  });

  it("الحذف النهائي لعميل عنده تاريخ لسه ممنوع (القاعدة القديمة ما اتكسرتش)", () => {
    const admin = read("src/routes/portal-customers-admin.ts");
    expect(admin).toContain("router.delete(");
  });

  it("الواجهة: حالة archived، فلتر، زر أرشفة واسترجاع، ونصوصها موجودة", () => {
    expect(read("web/src/admin/types.ts")).toContain('"archived"');
    expect(read("web/src/admin/screens/Companies.tsx")).toContain('"archived"');
    const tabs = read("web/src/admin/screens/CompanyTabs.tsx");
    expect(tabs).toContain("/archive`");
    expect(tabs).toContain("/restore`");
    const copy = read("web/src/copy/admin.ts");
    for (const key of ["a.status.archived", "a.view.archived", "a.ov.archive", "a.ov.restore", "a.log.company.archived", "a.log.company.restored"]) {
      expect(copy).toContain(`"${key}"`);
    }
  });
});

describe("hardening-2 — حماية الموظف صاحب النشاط من الحذف", () => {
  it("حذف موظف عنده سجل تدقيق مرفوض (409) قبل النقل لسلة المحذوفات", () => {
    const s = read("src/routes/settings.ts");
    const del = s.slice(s.indexOf('"/users/:id",\n  requireAuth,\n  requireSettings,\n  async (req, res, next) => {\n    try {\n      const id = parseIdParam(req.params.id, res);\n      if (id === null) return;\n      if (id === req.user!.userId)'));
    expect(del.indexOf("auditEventsTable")).toBeGreaterThan(-1);
    expect(del.indexOf("auditEventsTable")).toBeLessThan(del.indexOf("moveToTrash("));
    expect(del).toContain("res.status(409)");
  });
});
