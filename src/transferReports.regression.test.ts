// إبلاغ العميل عن تحويل (53أ): الصلاحيات، الأقفال، الهجرة، وعدم تسريب بيانات داخلية. قراية الملفات كنص (من غير قاعدة بيانات).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PORTAL_PERMISSIONS, PORTAL_PERMISSION_GROUPS, resolveEffectivePermissions } from "./lib/portalPermissions";
import { defaultPaymentMethod } from "./lib/transferReportsCore";

const read = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");
const routes = read("src/routes/transfer-reports.ts");
const lib = read("src/lib/transferReports.ts");
const mig = read("migrations/0105_customer_transfer_reports.sql");
const slice = (s: string, from: string, to?: string) => s.slice(s.indexOf(from), to ? s.indexOf(to, s.indexOf(from)) : undefined);

describe("المسارات والصلاحيات", () => {
  it("مسارات البوابة بتطلب جلسة عميل + صلاحية payments.report", () => {
    expect(routes).toContain('requirePortalPermission("payments.report")');
    for (const r of ['router.get("/portal/payments/reports"', 'router.post("/portal/payments/reports"']) {
      const at = routes.indexOf(r);
      expect(at).toBeGreaterThan(-1);
      expect(routes.slice(at, at + 90)).toContain("...portal");
    }
  });
  it("الشركة بتتحدد من الجلسة بس، مش من جسم الطلب ولا الرابط", () => {
    const post = slice(routes, 'router.post("/portal/payments/reports"', 'const listQuery');
    expect(post).toContain("req.portalAuth!");
    expect(post).not.toMatch(/req\.body\.(companyId|portalCustomerId|contactId)/);
    const schema = slice(read("src/lib/transferReportsCore.ts"), "export const reportBodySchema", "export type ReportBody");
    expect(schema).not.toMatch(/companyId|portalCustomerId|contactId/);
    expect(lib).toContain("where r.portal_customer_id = ${companyId}");
  });
  it("مسارات الموظفين للإدارة العليا (finance): القراية view والقرار write", () => {
    expect(routes).toContain("requireRole(...PERMISSIONS.finance.view)");
    expect(routes).toContain("requireRole(...PERMISSIONS.finance.write)");
    for (const r of ['router.post("/transfer-reports/:id/confirm"', 'router.post("/transfer-reports/:id/reject"']) {
      expect(routes.slice(routes.indexOf(r), routes.indexOf(r) + 90)).toContain("...write");
    }
    expect(routes.slice(routes.indexOf('router.get("/transfer-reports"'), routes.indexOf('router.get("/transfer-reports"') + 80)).toContain("...view");
  });
  it("مفيش حذف ولا تعديل عام: التقرير بيتقرر فيه بس عبر تأكيد أو رفض", () => {
    expect(routes).not.toMatch(/router\.(delete|put|patch)\(/);
  });
  it("مركّب في التطبيق", () => {
    const m = read("src/main.ts");
    expect(m).toContain('import transferReportsRouter from "./routes/transfer-reports"');
    expect(m).toContain("apiRouter.use(transferReportsRouter)");
  });
  it("كل كتابة في معاملة، وإشعار العميل بعد الالتزام وفشله مش بيلغي القرار", () => {
    expect(routes.match(/db\s*\.transaction\(/g)?.length).toBe(3);
    const conf = slice(routes, 'router.post("/transfer-reports/:id/confirm"', 'router.post("/transfer-reports/:id/reject"');
    expect(conf.indexOf("db.transaction")).toBeLessThan(conf.indexOf("notifyCustomer("));
    expect(slice(routes, "async function notifyCustomer", "router.post(\"/transfer-reports/:id/confirm\"")).toMatch(/try[\s\S]*catch/);
  });
  it("ترجرات القاعدة بتتحوّل لرسايل واضحة", () => {
    for (const s of ["transfer_reports_reference_unique", "TRANSFER_REPORT_FINAL", "GL_PERIOD_CLOSED"]) expect(routes).toContain(s);
  });
});

describe("المنطق: الأقفال والذرّية", () => {
  it("الإبلاغ: قفل الشركة أول حاجة، وبعده فحوص التكرار، وبعده الإدراج والمهمة", () => {
    const f = slice(lib, "export async function reportTransfer", "export async function listCompanyReports");
    const order = ["pg_advisory_xact_lock(hashtext(", "MAX_PENDING_PER_COMPANY", "DUPLICATE_REFERENCE", "insert into customer_transfer_reports", "createTask(", "writePortalAudit("].map((s) => f.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("مهمة المالية بموعد وتصعيد وبمفتاح منع تكرار، وبتتعمل في نفس معاملة التقرير", () => {
    const f = slice(lib, "export async function reportTransfer", "export async function listCompanyReports");
    for (const s of ["dueAt: reviewDueAt(now)", 'assigneeRole: "executive_manager"', 'escalateToRole: "chairman"', "dedupeKey: taskDedupeKey(id)", "}, null, undefined, tx)"]) expect(f).toContain(s);
  });
  it("القرار: صف التقرير FOR UPDATE الأول وبعده التحصيل (ترتيب الأقفال)", () => {
    const f = slice(lib, "export async function confirmReport");
    expect(lib).toContain("for update of r");
    expect(f.indexOf("loadReport(tx, id, true)")).toBeLessThan(f.indexOf("createPayment("));
    expect(f.indexOf("createPayment(")).toBeLessThan(f.indexOf("set status = 'confirmed'"));
    expect(f.indexOf("set status = 'confirmed'")).toBeLessThan(f.indexOf("closeTask("));
  });
  it("التأكيد بيسجّل تحصيل رسمي مرة واحدة ويمنع التأكيد المزدوج", () => {
    const f = slice(lib, "export async function confirmReport", "export async function rejectReport");
    expect(f.match(/createPayment\(/g)?.length).toBe(1);
    expect(f).toContain("canDecide(r.status)");
    expect(f).toContain("ALREADY_DECIDED");
    expect(f).toContain("payment_id = ${pay.id}");
  });
  it("الرفض بسبب إجباري ومبيعملش تحصيل", () => {
    const f = slice(lib, "export async function rejectReport");
    expect(f).not.toContain("createPayment(");
    expect(f).toContain("canDecide(r.status)");
    expect(read("src/lib/transferReportsCore.ts")).toContain("REASON_MIN");
  });
  it("كل قرار متدقّق (سجل الحوكمة) وبسبب لو في فرق مبلغ", () => {
    expect(lib).toContain('"transfer_reports.confirmed"');
    expect(lib).toContain('"transfer_reports.rejected"');
    expect(lib).toContain("reason: decision.differs");
  });
  it("المهمة بتتقفل في نفس معاملة القرار (مش معاملة تانية)", () => {
    expect(lib).toContain("transaction: <T>(cb: (t: Exec) => Promise<T>) => cb(tx)");
  });
  it("المحفظة نقدي والباقي بنك: نفس القاعدة في السيرفر والواجهة", () => {
    expect(defaultPaymentMethod("wallet")).toBe("cash");
    expect(read("web/src/staff/Transfers.tsx")).toContain('m === "wallet" ? "cash" : "bank"');
  });
});

describe("الهجرة 0105: الضمانات على القاعدة", () => {
  it("رقم هجرة بعد 0104، وفيها Rollback", () => {
    expect(mig).toContain("Rollback:");
    expect(mig).toContain("DROP TABLE IF EXISTS \"customer_transfer_reports\"");
  });
  it("مبلغ موجب وحالات محدودة وطريقة من قايمة", () => {
    expect(mig).toContain('CHECK ("amount" > 0)');
    expect(mig).toContain("CHECK (\"status\" IN ('pending','confirmed','rejected'))");
    expect(mig).toContain("CHECK (\"method\" IN ('bank','instapay','wallet'))");
  });
  it("المؤكَّد لازم له تحصيل ومبلغ، والمرفوض لازم له سبب", () => {
    expect(mig).toContain('"payment_id" IS NOT NULL AND "confirmed_amount" IS NOT NULL');
    expect(mig).toContain("length(btrim(coalesce(\"reject_reason\", ''))) >= 3");
  });
  it("منع تكرار رقم العملية لنفس العميل (معلّق أو مؤكَّد) وبعد الرفض ينفع يتبلّغ تاني", () => {
    expect(mig).toContain("CREATE UNIQUE INDEX IF NOT EXISTS \"transfer_reports_reference_unique\"");
    expect(mig).toContain("lower(btrim(\"reference\"))");
    expect(mig).toContain("WHERE \"status\" IN ('pending','confirmed')");
  });
  it("بعد القرار التقرير مبيتعدّلش، والبيانات الأساسية مقفولة حتى وهو معلّق", () => {
    expect(mig).toContain("TRANSFER_REPORT_FINAL");
    expect(mig).toContain("TRANSFER_REPORT_FIELDS_LOCKED");
    expect(mig).toContain("BEFORE UPDATE");
  });
  it("ترقيم البلاغات TR- بدون تكرار لو الهجرة اتشغّلت مرتين", () => {
    expect(mig).toContain("'transfer_report','TR-'");
    expect(mig).toContain("WHERE NOT EXISTS");
  });
  it("الهجرة آمنة للتكرار (IF NOT EXISTS / OR REPLACE)", () => {
    expect(mig).toContain("CREATE TABLE IF NOT EXISTS");
    expect(mig).toContain("CREATE OR REPLACE FUNCTION");
    expect(mig).toContain("DROP TRIGGER IF EXISTS");
  });
  it("المخطط (drizzle) متطابق مع الأعمدة الأساسية", () => {
    const s = read("src/db/schema/transferReports.ts");
    for (const c of ["report_number", "contact_id", "portal_customer_id", "transfer_date", "confirmed_amount", "reject_reason", "payment_id", "task_id"]) {
      expect(s, c).toContain(`"${c}"`);
      expect(mig, c).toContain(`"${c}"`);
    }
    expect(read("src/db/schema/index.ts")).toContain('export * from "./transferReports"');
  });
});

describe("صلاحية البوابة payments.report", () => {
  it("مسجّلة في السجل وفي مجموعة موجودة", () => {
    const p = PORTAL_PERMISSIONS.find((x) => x.key === "payments.report");
    expect(p).toBeTruthy();
    expect(PORTAL_PERMISSION_GROUPS.some((g) => g.key === p!.group)).toBe(true);
  });
  it("صاحب الشركة بياخدها تلقائيًا، وموظف بدور مشتري لأ", () => {
    expect(resolveEffectivePermissions({ isOwner: true, rolePermissions: [] }).has("payments.report")).toBe(true);
    expect(resolveEffectivePermissions({ isOwner: false, rolePermissions: ["catalog.view", "orders.create"] }).has("payments.report")).toBe(false);
  });
  it("الرفض الصريح (deny) بيمنعها حتى لو الدور فيه", () => {
    const r = resolveEffectivePermissions({ isOwner: false, rolePermissions: ["payments.report"], overrides: [{ permissionKey: "payments.report", effect: "deny" }] });
    expect(r.has("payments.report")).toBe(false);
  });
  it("قوالب الأدوار (رئيس الشركة والمدير) بتاخدها في الهجرة، والمشتري والمطّلع لأ", () => {
    expect(mig).toContain("\"key\" IN ('owner','manager')");
    expect(mig).toContain("array_append(\"permissions\", 'payments.report')");
    expect(mig).toContain("NOT ('payments.report' = ANY(\"permissions\"))");
  });
});

describe("الواجهة", () => {
  it("شاشة البوابة بتحمّل بالكسل وبصلاحية، ومعاها زرار في القايمة بنفس الصلاحية", () => {
    const r = read("web/src/portal/routes.tsx");
    expect(r).toContain('import("./screens/Payments")');
    expect(r).toContain('perm="payments.report"');
    expect(read("web/src/portal/screens/Shell.tsx")).toContain('can("payments.report")');
  });
  it("تبويب المحاسبة بيعرض الشاشة، وكل ملف بيستخدم نصوصه بيعمل لها import", () => {
    expect(read("web/src/staff/Ledger.tsx")).toContain("<Transfers />");
    for (const f of ["web/src/staff/Transfers.tsx", "web/src/portal/screens/Payments.tsx", "web/src/staff/Ledger.tsx"]) expect(read(f), f).toMatch(/import "(\.\.\/)+copy\/transfers"/);
  });
  it("إشعار العميل بيفتح شاشة التحويلات", () => {
    expect(read("web/src/portal/screens/Notifications.tsx")).toContain('"transfer_report"');
    expect(read("web/src/portal/screens/Notifications.tsx")).toContain('"/portal/payments"');
  });
  it("زرار التأكيد بيمنع المبلغ المختلف من غير ملاحظة، والرفض من غير سبب", () => {
    const t = read("web/src/staff/Transfers.tsx");
    expect(t).toContain("noteMissing");
    expect(t).toContain("reason.trim().length < 3");
  });
  it("مفيش نص عربي مباشر في كود الشاشتين (كله من ملف النصوص)", () => {
    for (const f of ["web/src/staff/Transfers.tsx", "web/src/portal/screens/Payments.tsx"]) expect(read(f), f).not.toMatch(/["'`][^"'`\n]*[؀-ۿ][^"'`\n]*["'`]/);
  });
});
