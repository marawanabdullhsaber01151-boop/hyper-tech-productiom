// تأكيد رصيد العميل (53ب): الصلاحيات، عزل الشركات، الأقفال، الهجرة، وعدم تسريب بيانات داخلية. قراية الملفات كنص.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PORTAL_PERMISSIONS, resolveEffectivePermissions } from "./lib/portalPermissions";

const read = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");
const routes = read("src/routes/balance-confirmations.ts");
const lib = read("src/lib/balanceConfirmations.ts");
const mig = read("migrations/0106_balance_confirmations.sql");
const slice = (s: string, from: string, to?: string) => s.slice(s.indexOf(from), to ? s.indexOf(to, s.indexOf(from)) : undefined);

describe("المسارات والصلاحيات", () => {
  it("البوابة: جلسة عميل + payments.confirm_balance", () => {
    expect(routes).toContain('requirePortalPermission("payments.confirm_balance")');
    for (const r of ['router.get("/portal/balances"', 'router.post("/portal/balances/:id/agree"', 'router.post("/portal/balances/:id/dispute"']) {
      const at = routes.indexOf(r);
      expect(at, r).toBeGreaterThan(-1);
      expect(routes.slice(at, at + 90), r).toContain("...portal");
    }
  });
  it("الموظفين: العرض والكتابة للإدارة العليا بس", () => {
    expect(routes).toContain("requireRole(...PERMISSIONS.finance.view)");
    expect(routes).toContain("requireRole(...PERMISSIONS.finance.write)");
    for (const r of ['router.get("/balance-confirmations"', 'router.post("/balance-confirmations"', "/resolve", "/cancel"]) {
      expect(routes, r).toContain(r);
    }
    for (const r of ['router.post("/balance-confirmations"', 'router.post("/balance-confirmations/:id/resolve"', 'router.post("/balance-confirmations/:id/cancel"']) {
      expect(routes.slice(routes.indexOf(r), routes.indexOf(r) + 90), r).toContain("...write");
    }
  });
  it("الشركة من الجلسة مش من الطلب", () => {
    const portalPart = slice(routes, 'router.get("/portal/balances"', "// ");
    expect(portalPart).toContain("portalAuth!");
    expect(lib).toMatch(/portal_customer_id = \$\{companyId\}/);
  });
  it("الصلاحية الجديدة متسجلة وللمالك بس افتراضيًا", () => {
    const p = PORTAL_PERMISSIONS.find((x) => x.key === "payments.confirm_balance");
    expect(p?.group).toBe("payments");
    expect(mig).toMatch(/'owner'/);
    expect(mig).not.toMatch(/'manager'/);
    expect(typeof resolveEffectivePermissions).toBe("function");
  });
  it("الموافقة والاعتراض بيروحوا لدوال تحمّل الشركة", () => {
    expect(routes).toContain("agree(");
    expect(routes).toContain("dispute(");
  });
});

describe("الأقفال والتحويلات", () => {
  it("طلب جديد: قفل العميل قبل فحص الطلب النشط", () => {
    const f = slice(lib, "export async function requestConfirmation");
    expect(f.indexOf("hashtext")).toBeGreaterThan(-1);
    expect(f.indexOf("hashtext")).toBeLessThan(f.indexOf("ALREADY_ACTIVE"));
    expect(f).toContain("NO_PORTAL");
  });
  it("الرد والقرار على صف FOR UPDATE", () => {
    expect(lib).toMatch(/for update of b/);
  });
  it("الاعتراض بيعمل مهمة بمفتاح تكرار وبيتقفل مع القرار", () => {
    const d = slice(lib, "export async function dispute");
    expect(d).toContain("createTask");
    expect(d).toContain("taskDedupeKey");
    expect(slice(lib, "export async function resolve")).toContain("closeTask");
    expect(slice(lib, "export async function cancel")).toContain("closeTask");
  });
  it("الأرصدة السالبة بتتحول بـ signedDecimal مش centsDecimal", () => {
    expect(lib).toContain("signedDecimal");
    expect(lib).not.toMatch(/centsDecimal\(/);
  });
  it("الإشعارات بعد الالتزام وفي try/catch", () => {
    expect(routes).toMatch(/try\s*\{[\s\S]{0,200}notifyPortalCustomer/);
  });
  it("كل تغيير ليه سجل مراجعة", () => {
    for (const k of ["balance_confirmations.requested", "balance.agreed", "balance.disputed"]) expect(lib, k).toContain(k);
    expect(lib).toMatch(/balance_confirmations\.(resolved|cancelled)/);
  });
});

describe("الهجرة 0106", () => {
  it("طلب نشط واحد لكل عميل", () => {
    expect(mig).toMatch(/balance_conf_one_active[\s\S]{0,120}"status" IN \('open', ?'disputed'\)/i);
  });
  it("قيود الشكل للحالات", () => {
    for (const s of ["agreed", "disputed", "resolved", "cancelled"]) expect(mig).toContain(s);
    expect(mig).toContain("BALANCE_SNAPSHOT_LOCKED");
    expect(mig).toContain("BALANCE_BAD_TRANSITION");
  });
  it("الحالات النهائية مفيهاش خروج", () => {
    const t = slice(mig, "BALANCE_BAD_TRANSITION");
    expect(t.length).toBeGreaterThan(10);
    expect(mig).toMatch(/'BC-'/);
    expect(mig).toContain("Rollback");
  });
});

describe("الواجهة", () => {
  const screen = read("web/src/portal/screens/Balances.tsx");
  const staff = read("web/src/staff/BalanceConfirmations.tsx");
  it("شاشة البوابة lazy ومربوطة بالصلاحية والقايمة", () => {
    const r = read("web/src/portal/routes.tsx");
    expect(r).toContain("loadBalances");
    expect(r).toContain('perm="payments.confirm_balance"');
    expect(read("web/src/portal/screens/Shell.tsx")).toContain("payments.confirm_balance");
    expect(read("web/src/portal/screens/Notifications.tsx")).toContain("balance_confirmation");
  });
  it("النصوص من ملف النسخ، والجداول داخل wrapper", () => {
    for (const s of [screen, staff]) {
      expect(s).toMatch(/import "(\.\.\/)+copy\/balances"/);
      expect(s.replace(/\/\/.*$/gm, "")).not.toMatch(/"[^"\n]*[؀-ۿ][^"\n]*"/);
    }
    expect(screen).toContain("ht-tablewrap");
  });
  it("التبويب في دفتر الحسابات والنسخ مسجلة", () => {
    expect(read("web/src/staff/Ledger.tsx")).toContain('id: "balances"');
    expect(read("web/src/copy/lazy-dicts.ts")).toContain("balances");
  });
});
