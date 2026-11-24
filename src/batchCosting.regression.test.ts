// التكلفة المعيارية وربحية الدفعة (54): الصلاحيات، الأقفال، الهجرة، والواجهة. قراية الملفات كنص (من غير قاعدة بيانات).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");
const routes = read("src/routes/batch-costing.ts");
const lib = read("src/lib/batchCosting.ts");
const core = read("src/lib/batchCostingCore.ts");
const mig = read("migrations/0108_standard_costing.sql");
const slice = (s: string, from: string, to?: string) => s.slice(s.indexOf(from), to ? s.indexOf(to, s.indexOf(from)) : undefined);

describe("المسارات", () => {
  it("القراية finance.view والكتابة finance.write", () => {
    expect(routes).toContain("requireRole(...PERMISSIONS.finance.view)");
    expect(routes).toContain("requireRole(...PERMISSIONS.finance.write)");
    for (const r of ['router.get("/costing/standards"', 'router.get("/costing/standards/:recipeId/history"', 'router.get("/costing/batches"', 'router.get("/costing/batches/:id"']) {
      expect(routes.slice(routes.indexOf(r), routes.indexOf(r) + 90), r).toContain("...view");
    }
    for (const r of ['router.put("/costing/standards/:recipeId"', 'router.post("/costing/batches/:id/sheet"', 'router.post("/costing/batches/:id/finalize"']) {
      expect(routes.slice(routes.indexOf(r), routes.indexOf(r) + 90), r).toContain("...write");
    }
  });
  it("المعيار بيتحقق بالـschema وبسبب، والمعرّفات بتتفحص", () => {
    expect(routes).toContain("standardBodySchema.parse");
    expect(routes.match(/parseIdParam\(/g)!.length).toBeGreaterThanOrEqual(5);
  });
  it("مركّب في main وأخطاء الترجرات بتتحوّل لرسايل مفهومة", () => {
    expect(read("src/main.ts")).toContain("apiRouter.use(batchCostingRouter)");
    for (const c of ["BATCH_SHEET_FINAL", "BATCH_NOT_COMPLETED", "STANDARD_HISTORY_IMMUTABLE"]) expect(routes, c).toContain(c);
  });
});

describe("المنطق والأقفال", () => {
  it("تغيير المعيار: قفل الوصفة ثم صف المعيار FOR UPDATE، وإصدار جديد وسجل وتدقيق", () => {
    const f = slice(lib, "export async function setStandard", "export async function standardHistory");
    expect(f.indexOf("hashtext")).toBeGreaterThan(-1);
    expect(f.indexOf("hashtext")).toBeLessThan(f.indexOf("for update"));
    expect(f).toContain("insert into recipe_standard_history");
    expect(f).toContain("costing.standard_set");
    expect(f).toContain("version");
  });
  it("الكشف: قفل الدفعة ثم صف الكشف FOR UPDATE قبل الحساب، ورفض النهائي", () => {
    const f = slice(lib, "async function writeSheet", "export const saveBatchSheet");
    expect(f.indexOf("hashtext")).toBeLessThan(f.indexOf("for update"));
    expect(f.indexOf("for update")).toBeLessThan(f.indexOf("loadInputs"));
    expect(f).toContain("SHEET_FINAL");
    expect(f).toContain("BATCH_NOT_COMPLETED");
    expect(f).toContain("costing.sheet_finalized");
    expect(f).toContain("costing.sheet_computed");
  });
  it("بيحسب من قيود التكلفة المعتمدة بس", () => {
    expect(lib).toMatch(/from production_cost_entries where workflow_order_id = \$\{orderId\} and status = 'approved'/);
  });
  it("الكشف النهائي بيتعرض زي ما هو محفوظ مش بيتعاد حسابه", () => {
    const f = slice(lib, "export async function viewBatchSheet", "function fromSaved");
    expect(f).toMatch(/status === "final"\) return fromSaved/);
  });
  it("الحساب كله بالقروش bigint ومفيش Number/parseFloat على الفلوس في القواعد", () => {
    expect(core).not.toMatch(/parseFloat|Number\(/);
    expect(lib).not.toMatch(/parseFloat/);
  });
  it("مفيش centsDecimal (مش آمن للسالب)", () => {
    expect(lib + core).not.toContain("centsDecimal");
  });
});

describe("الهجرة 0108", () => {
  it("المعيار: قيود عدم السالب ونسبة السليم 0–100 وإصدار ≥ 1", () => {
    expect(mig).toMatch(/"yield_percent" > 0 AND "yield_percent" <= 100/);
    expect(mig).toMatch(/"labor" >= 0/);
    expect(mig).toMatch(/"version" >= 1/);
  });
  it("سجل المعايير للإضافة بس وسبب 3 حروف+", () => {
    expect(mig).toContain("STANDARD_HISTORY_IMMUTABLE");
    expect(mig).toMatch(/char_length\(btrim\("reason"\)\) >= 3/);
  });
  it("الكشف النهائي مقفول ضد التعديل والحذف، والاعتماد لدفعة مكتملة بس", () => {
    expect(mig).toContain("BATCH_SHEET_FINAL");
    expect(mig).toContain("BATCH_NOT_COMPLETED");
    expect(mig).toMatch(/b_status IS DISTINCT FROM 'completed'/);
    expect(mig).toMatch(/"status" = 'draft' OR \("finalized_at" IS NOT NULL/);
  });
  it("كشف واحد لكل دفعة، وفيها Rollback", () => {
    expect(mig).toMatch(/"batch_id" integer NOT NULL UNIQUE/);
    expect(mig).toContain("Rollback");
  });
  it("الترجر مبيقراش OLD في الإدخال", () => {
    const t = slice(mig, "CREATE OR REPLACE FUNCTION batch_cost_sheets_guard");
    expect(t).not.toMatch(/TG_OP = 'UPDATE' AND OLD/);
  });
});

describe("الواجهة", () => {
  const panel = read("web/src/staff/CostingPanel.tsx");
  it("النصوص من ملف النسخ ومسجّل، والتبويب مربوط، والجداول داخل wrapper", () => {
    expect(panel).toMatch(/import "\.\.\/copy\/costing"/);
    expect(panel.replace(/\/\/.*$/gm, "")).not.toMatch(/"[^"\n]*[؀-ۿ][^"\n]*"/);
    expect(read("web/src/copy/lazy-dicts.ts")).toContain("costing: costingCopy");
    expect(read("web/src/staff/Ledger.tsx")).toContain("<CostingPanel />");
    expect(panel).toContain("ht-tablewrap");
  });
  it("الانحراف الموجب أحمر (زيادة تكلفة) والسالب أخضر", () => {
    expect(panel).toMatch(/Number\(v\) > 0 \? "danger" : Number\(v\) < 0 \? "success"/);
  });
  it("اعتماد الكشف مقفول لحد ما الدفعة تكتمل، وبعد النهائي مفيش أزرار حساب", () => {
    expect(panel).toContain('s.meta.batchStatus !== "completed"');
    expect(panel).toContain("!isFinal");
  });
  it("بيكلّم المسارات الصح", () => {
    for (const r of ["/costing/batches", "/costing/standards", "/history", "put(`/costing/standards/", "/${path}"]) expect(panel, r).toContain(r);
  });
});
