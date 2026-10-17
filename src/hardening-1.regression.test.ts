/** @format */
/**
 * اختبارات ارتداد لحزمة hardening-1: كل اختبار بيمنع رجوع مشكلة معيّنة اتصلّحت من جذرها.
 * (نفس أسلوب المشروع في فحص نص المصدر — بتشتغل من غير قاعدة بيانات.)
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("hardening-1 — اختبارات ارتداد", () => {
  it("الراوتر خلف بروكسي Vercel: trust proxy متظبط (وإلا كل المستخدمين بيتشاركوا عدّاد الـrate-limit)", () => {
    const main = read("src/main.ts");
    expect(main).toContain('app.set("trust proxy", resolveTrustProxy(process.env))');
    expect(main.indexOf('app.set("trust proxy"')).toBeLessThan(main.indexOf("helmet({"));
  });

  it("كتالوج البوابة (القائمة والتفاصيل) بيتطلب تسجيل دخول عميل (BR-1)", () => {
    const portal = read("src/routes/portal.ts");
    for (const route of ['"/portal/products",', '"/portal/products/:id",']) {
      const at = portal.indexOf(`router.get(\n  ${route}`);
      expect(at).toBeGreaterThan(-1);
      const head = portal.slice(at, at + 400);
      expect(head).toContain("requirePortalAuth");
    }
    const web = read("web/src/portal/screens/Products.tsx");
    expect(web).not.toMatch(/\/portal\/products[^)]*anonymous: true/);
  });

  it("فلوس الفاتورة بأرقام صحيحة: مفيش Number×Number ولا toFixed في تأكيد طلب البوابة", () => {
    const src = read("src/routes/portal-orders.ts");
    expect(src).toContain("priceLines(");
    expect(src).not.toMatch(/Number\(o\.qty\)\s*\*\s*Number\(/);
    expect(src).not.toMatch(/Number\(order\.qty\)\s*\*\s*Number\(/);
    expect(src).not.toContain("subtotal.toFixed(2)");
  });

  it("سعر الصنف بيتحقق منه عند الحدّ (مش أي نص)", () => {
    const schema = read("src/db/schema/portal-order-reviews.ts");
    expect(schema).toContain("MONEY_INPUT_PATTERN");
  });

  it("إشعارات ما بعد الـcommit ما بتقلبش النجاح لـ500 (والرسالة النصية تفضل غير منتظَرة)", () => {
    const src = read("src/routes/portal-orders.ts");
    expect(src).toContain("runAfterCommit(");
    // نطاق القرارين فقط (تأكيد/رفض الإرسالية) — مسارات تانية في الملف (زي إلغاء السطر) خارج هذا التسليم
    const decisions = src.slice(src.indexOf("/portal-orders/:batchRef/confirm"), src.indexOf("/portal-orders/:id/claim"));
    expect(decisions).not.toMatch(/\n\s{6}await notifyRoles?\(/);
    expect(decisions).not.toMatch(/\n\s{6}await notifyPortalCustomer\(/);
    expect(decisions).toMatch(/void runAfterCommit\(/);
  });

  it("الإرساليات المعلّقة: ترقيم على مستوى الإرسالية والاستبعاد في SQL (مش تحميل جدول المراجعات كله)", () => {
    const src = read("src/routes/portal-orders.ts");
    expect(src).toContain("NOT EXISTS");
    expect(src).not.toContain("limit * 10");
    const pending = src.slice(src.indexOf('"/portal-orders/pending"'), src.indexOf("/portal-orders/:batchRef/confirm"));
    expect(pending).not.toMatch(/\.from\(portalOrderReviewsTable\)/);
  });

  it("التحقق من سلسلة التدقيق على دفعات (مش select() للجدول كله)", () => {
    const gov = read("src/routes/governance.ts");
    const verify = gov.slice(gov.indexOf('"/governance/audit-events/verify"'));
    expect(verify).toContain("verifyAuditBatch");
    expect(verify).toContain(".limit(BATCH)");
    expect(verify).not.toMatch(/await db\.select\(\)\.from\(auditEventsTable\)\.orderBy/);
  });

  it("تحديث آخر نشاط للجلسة مرة في الدقيقة مش مع كل طلب", () => {
    const auth = read("src/middleware/auth.ts");
    expect(auth).toContain("shouldTouchSession(row.lastActiveAt)");
  });

  it("هجرة 0077: سجل التدقيق غير قابل للتعديل إلا بإعلان صيانة، وفيه استثناء الـFK الوحيد", () => {
    const sql = read("migrations/0077_hardening_audit_idempotency.sql");
    expect(sql).toContain("BEFORE UPDATE OR DELETE ON audit_events");
    expect(sql).toContain("BEFORE TRUNCATE ON audit_events");
    expect(sql).toContain("hypertech.audit_maintenance");
    expect(sql).toContain("-- Rollback:");
    // الاستثناء لازم يكون IF متداخل مش AND مع TG_OP (PL/pgSQL مابيضمنش short-circuit)
    expect(sql).not.toMatch(/IF TG_OP = 'UPDATE'\s+AND/);
    for (const script of ["scripts/wipe-customers.mjs", "scripts/reset-test-data.mjs"]) {
      expect(read(script)).toContain("SET LOCAL hypertech.audit_maintenance = 'on'");
    }
  });

  it("الكرون بينضّف سجل الـidempotency", () => {
    expect(read("src/routes/chat-staff.ts")).toContain("purgeExpiredCommands()");
  });

  it("مفيش ملفات بيانات حقيقية ولا بقايا تسليم قديمة في الجذر", () => {
    for (const leftover of ["hyper_erp_backup_2026-08-22.json", "migrations.zip", "manual-migrate.js", "src/routes/portal.ts.phase-07.patch"]) {
      expect(existsSync(resolve(process.cwd(), leftover))).toBe(false);
    }
    expect(read(".gitignore")).toContain("*backup*.json");
  });

  it("health مابيشترطش PORTAL_JWT_SECRET (مش مستخدم أصلًا)", () => {
    expect(read("src/routes/health.ts")).not.toContain('"PORTAL_JWT_SECRET"');
  });
});
