/** @format */
// حدود الائتمان (52): الحراسة على مستوى الكود. قراية الملفات كنص عشان الاختبار ميحتاجش قاعدة بيانات.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");
const count = (s: string, needle: string) => s.split(needle).length - 1;
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : []; });

describe("حدود الائتمان: مسارات الإدارة", () => {
  const r = read("src/routes/credit.ts");
  it("القراية view والكتابة write للإدارة العليا، ومفيش حذف", () => {
    expect(r).toContain("requireRole(...PERMISSIONS.finance.view)");
    expect(r).toContain("requireRole(...PERMISSIONS.finance.write)");
    expect(r.match(/router\.get\(/g)?.length).toBe(1);
    expect(r.match(/router\.put\(/g)?.length).toBe(1);
    expect(r).not.toMatch(/router\.(post|patch|delete)\(/);
    expect(r.slice(r.indexOf('router.put("/credit/limit"'), r.indexOf('router.put("/credit/limit"') + 120)).toContain("...write");
  });
  it("تغيير الحد في معاملة واحدة مع تدقيق بقيمة قبل وبعد وسبب إجباري، والمورد مرفوض", () => {
    expect(r).toContain("db.transaction");
    expect(r).toContain('actionKey: "credit.limit_set"');
    expect(r).toContain("beforeData");
    expect(r).toContain("min(3");
    expect(r).toContain("NOT_A_CUSTOMER");
    expect(r).toContain("for update");
    expect(r).toContain("parseCreditLimit");
  });
  it("مركّب في التطبيق", () => {
    expect(read("src/main.ts")).toContain("apiRouter.use(creditRouter)");
  });
});

describe("حدود الائتمان: ربطها بأوامر البيع", () => {
  const s = read("src/routes/sales.ts");
  it("الفحص في الإنشاء (POST) وتغيير الحالة (PATCH) بالظبط", () => {
    expect(count(s, "assessOrderCredit(tx")).toBe(2);
    expect(count(s, "CREDIT_OVERRIDE_ACTION : \"sales.approve\"")).toBe(2);
  });
  it("لو التجاوز محتاج اعتماد ومفيش سياسة: الطلب يفشل (مش بيعدّي بصمت)", () => {
    expect(count(s, "if (creditHold && !approval) throw errorWithStatus(")).toBe(2);
  });
  it("التحذير بيتسجّل في التدقيق في المسارين", () => {
    expect(count(s, 'actionKey: "sales.credit_warning"')).toBe(2);
  });
  it("الحجز للاعتماد بيتفتح حتى لو الانتقال نفسه مش بيحجز مخزون", () => {
    expect(s).toContain("if (requiresApproval(transitionPlan) || creditHold)");
  });
  it("قرار الاعتماد بيرجّع الأمر لحالته الأصلية من الـmetadata من غير ما يعتمد على مفتاح بعينه", () => {
    const g = read("src/routes/governance.ts");
    expect(g).toContain("originalStatus");
    expect(g).not.toMatch(/actionKey\s*===\s*["']sales\.approve["']/);
  });
});

describe("حدود الائتمان: القفل والفحص", () => {
  const l = read("src/lib/credit.ts");
  it("القفل بيتاخد قبل حساب التعرّض، والسياسة المقفولة والعميل من غير حد بيخرجوا قبل أي قفل", () => {
    const iPolicy = l.indexOf('if (policy === "off") return null');
    const iLimit = l.indexOf("if (limit === null) return null");
    const iLock = l.indexOf("await lockCustomerCredit(tx, a.contactId)");
    const iExp = l.indexOf("await customerExposure(tx, a.contactId, a.orderId)");
    expect(iPolicy).toBeGreaterThan(-1);
    expect(iPolicy).toBeLessThan(iLimit);
    expect(iLimit).toBeLessThan(iLock);
    expect(iLock).toBeLessThan(iExp);
  });
  it("الأمر نفسه مستثنى من المديونية (عشان إعادة التأكيد ما تحسبوش مرتين)", () => {
    expect(l).toContain("excludeOrderId");
    expect(l).toContain("inv.orderId === excludeOrderId");
  });
  it("رقم القفل 4803 مش مستخدم في أي مكان تاني (مفيش تعارض أقفال)", () => {
    const hits = walk(resolve(__dirname)).filter((f) => !f.endsWith(".test.ts") && /\b4803\b/.test(readFileSync(f, "utf8")));
    expect(hits.map((f) => basename(f))).toEqual(["credit.ts"]);
  });
  it("السياسة بتتقرا من الإعدادات والقراية الفاشلة بترجع للتحذير (مش بتوقف البيع)", () => {
    expect(l).toContain("loadSettingValues");
    expect(l).toMatch(/catch\s*\{\s*return "warn"/);
  });
});

describe("حدود الائتمان: الهجرة 0104", () => {
  const m = read("migrations/0104_credit_override_policy.sql");
  it("سياسة الاعتماد للمدير التنفيذي ورئيس المجلس بس، وبتتكرر بأمان", () => {
    expect(m).toContain("sales.credit_override");
    expect(m).toContain('["executive_manager","chairman"]');
    expect(m).not.toContain("sales_manager");
    expect(m).toContain("WHERE NOT EXISTS");
    expect(m).toContain("Rollback");
  });
});
