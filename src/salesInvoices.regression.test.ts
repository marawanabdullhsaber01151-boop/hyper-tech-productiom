/** @format */
// الفاتورة الإلكترونية الداخلية (56): حراسة بنيوية (هجرة، مسارات، أمان، ما بيتسرّبش مفتاح ولا بيانات عميل).
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { invoiceGuardOf } from "./lib/invoiceGuard";
import { PERMISSIONS } from "./lib/permissions";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
const mig = read("migrations/0109_sales_invoices.sql");
const lib = read("src/lib/salesInvoices.ts");
const route = read("src/routes/invoices.ts");
const core = read("src/lib/invoiceSealCore.ts");

describe("الهجرة 0109", () => {
  it("آخر هجرة وبعد 0108 من غير فجوة", () => {
    const files = readdirSync(resolve(__dirname, "../migrations")).filter((f) => /^\d{4}_/.test(f)).sort();
    expect(files.at(-1)).toBe("0109_sales_invoices.sql");
    expect(files.at(-2)).toMatch(/^0108_/);
  });
  it("رقم الفاتورة وأمر البيع فريدين، والختم 64 hex، وفيه Rollback", () => {
    expect(mig).toMatch(/"invoice_number" text NOT NULL UNIQUE/);
    expect(mig).toMatch(/"order_id" integer NOT NULL UNIQUE REFERENCES "sales_orders"/);
    expect(mig).toContain("^[0-9a-f]{64}$");
    expect(mig).toContain("Rollback:");
  });
  it("الفاتورة ثابتة (ترجر على التعديل والحذف)", () => {
    expect(mig).toMatch(/BEFORE UPDATE OR DELETE ON "sales_invoices"/);
    expect(mig).toContain("INV_IMMUTABLE");
  });
  it("الأمر المفوتر مقفول: إجمالي/عميل/تاريخ/إلغاء/رجوع لمسودة/حذف + الأصناف", () => {
    for (const s of ["NEW.total IS DISTINCT FROM OLD.total", "NEW.subtotal IS DISTINCT FROM OLD.subtotal", "NEW.contact_id IS DISTINCT FROM OLD.contact_id", "NEW.date IS DISTINCT FROM OLD.date", "NEW.status = 'cancelled'", "NEW.status = 'draft'", "TG_OP = 'DELETE' THEN RAISE EXCEPTION 'INV_ORDER_LOCKED'"]) expect(mig, s).toContain(s);
    expect(mig).toMatch(/BEFORE INSERT OR UPDATE OR DELETE ON "sales_order_items"/);
  });
  it("الترقيم من phase0 (قفل الصف جوه المعاملة) بادئة INV- و6 أرقام", () => {
    expect(mig).toContain("'sales_invoice', 'INV-', 1, 6");
    expect(lib).toContain('nextPhase0Number(tx, "sales_invoice")');
  });
  it("مفيش حقل للمفتاح في القاعدة (بصمة بس)", () => {
    expect(mig).not.toMatch(/seal_key"|secret|private/i);
    expect(mig).toContain('"seal_key_id" text NOT NULL');
  });
});

describe("المسارات والصلاحيات", () => {
  it("الإصدار للمالية (finance.write) بس، والقراءة مبيعات أو مالية، والفحص للمالية", () => {
    expect(route).toMatch(/const finance = \[requireAuth, requireRole\(\.\.\.PERMISSIONS\.finance\.write\)\]/);
    expect(route).toMatch(/router\.post\("\/sales\/:id\/invoice", \.\.\.finance/);
    expect(route).toMatch(/router\.get\("\/invoices\/integrity", \.\.\.financeView/);
    expect(PERMISSIONS.finance.write).toEqual(["chairman", "executive_manager"]);
  });
  it("مفيش مسار /invoices/:id (من غير مستهلك)، فمسار integrity مش هيتلخبط مع id", () => {
    expect(route).not.toContain('"/invoices/:id"');
  });
  it("الإصدار بيطلب المفتاح قبل المعاملة، ومبيتسجلش المفتاح في أي مكان", () => {
    expect(route.indexOf("requireSealKey()")).toBeLessThan(route.indexOf("db.transaction"));
    for (const src of [lib, route, core]) expect(src).not.toMatch(/(logger|console)\.\w+\([^)]*key/i);
  });
  it("المسار العام: من غير تسجيل دخول، بحد طلبات، ومتحقق من الشكل، ومن غير تخزين مؤقت", () => {
    const pub = route.slice(route.indexOf('"/public/invoices/verify"'));
    expect(pub).not.toContain("requireAuth");
    expect(route).toMatch(/max: 30/);
    expect(pub).toContain("no-store");
    expect(route).toContain("numberShape");
    expect(route).toContain("tokenShape");
  });
  it("الرد العام مبيرجّعش اسم العميل ولا الأصناف ولا الختم الكامل", () => {
    const v = lib.slice(lib.indexOf("export async function verifyPublic"), lib.indexOf("export interface IntegrityReport"));
    expect(v).not.toMatch(/customerName|lines|orderNumber|seal:/);
  });
  it("متركّب في main.ts", () => {
    expect(read("src/main.ts")).toContain("apiRouter.use(invoicesRouter)");
  });
});

describe("قواعد الإصدار", () => {
  it("الأمر بيتقفل FOR UPDATE وبيتفحص: حالة، عميل، فاتورة سابقة، أصناف، فترة مقفولة", () => {
    expect(lib).toContain("for update of o");
    for (const code of ["NOT_INVOICEABLE", "NO_CUSTOMER", "ALREADY_INVOICED", "NO_ITEMS", "PERIOD_CLOSED"]) expect(lib, code).toContain(code);
  });
  it("الضريبة مشمولة في السعر: الإجمالي بيتاخد من الأمر زي ما هو (مفيش تغيير في القيد)", () => {
    expect(lib).toContain("vatInclusive(String(order.total)");
    expect(lib).toMatch(/total: String\(order\.total\)/);
  });
  it("التدقيق بيتسجّل جوه نفس المعاملة", () => {
    expect(lib).toMatch(/writeAuditEvent\(\{\s*executor: tx/);
    expect(lib).toContain('"invoices.issued"');
  });
});

describe("رسايل الترجر", () => {
  it("errorHandler بيستخدمها قبل أخطاء النطاق العامة", () => {
    const h = read("src/middleware/errorHandler.ts");
    expect(h).toContain("invoiceGuardOf(err)");
    expect(h.indexOf("invoiceGuardOf(err)")).toBeLessThan(h.indexOf("isDomainError(err)"));
  });
  it("بتتحوّل لـ409 برسالة عربية حتى لو متغلّفة في cause", () => {
    const wrapped = Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("INV_ORDER_LOCKED"), { code: "P0001" }) });
    expect(invoiceGuardOf(wrapped)?.code).toBe("INVOICE_ORDER_LOCKED");
    expect(invoiceGuardOf(new Error("INV_IMMUTABLE"))?.code).toBe("INVOICE_IMMUTABLE");
    expect(invoiceGuardOf(new Error("حاجة تانية"))).toBeNull();
  });
});
