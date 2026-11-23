// إقفال الفترة (55): الصلاحيات، الأقفال، الهجرة، التذكير، والواجهة. قراية الملفات كنص (من غير قاعدة بيانات).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SETTING_DEFS } from "./domain/settings-registry";

const read = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");
const routes = read("src/routes/ledger-periods.ts");
const lib = read("src/lib/periodClose.ts");
const mig = read("migrations/0107_period_close.sql");
const slice = (s: string, from: string, to?: string) => s.slice(s.indexOf(from), to ? s.indexOf(to, s.indexOf(from)) : undefined);

describe("المسارات", () => {
  it("القفل والفتح للكتابة (finance.write) والعرض (finance.view)", () => {
    expect(routes).toContain("requireRole(...PERMISSIONS.finance.write)");
    expect(routes).toContain("requireRole(...PERMISSIONS.finance.view)");
    for (const r of ['router.post("/ledger/periods/:id/close"', 'router.post("/ledger/periods/:id/reopen"']) {
      expect(routes.slice(routes.indexOf(r), routes.indexOf(r) + 90), r).toContain("...write");
    }
    for (const r of ['router.get("/ledger/periods/check"', 'router.get("/ledger/period-events"']) {
      expect(routes.slice(routes.indexOf(r), routes.indexOf(r) + 90), r).toContain("...view");
    }
  });
  it("/check متعرّف قبل /:id وسبب الفتح بيتحقق من الـschema", () => {
    expect(routes).toContain("reopenBodySchema.parse");
    expect(routes).toContain("closeBodySchema.parse");
  });
  it("الموجّه متركّب قبل ledgerRouter", () => {
    const m = read("src/main.ts");
    expect(m.indexOf("apiRouter.use(ledgerPeriodsRouter)")).toBeGreaterThan(-1);
    expect(m.indexOf("apiRouter.use(ledgerPeriodsRouter)")).toBeLessThan(m.indexOf("apiRouter.use(ledgerRouter)"));
  });
  it("إشعار الفتح بعد الالتزام وفي try/catch", () => {
    expect(routes).toMatch(/await db\.transaction[\s\S]{0,200}try\s*\{[\s\S]{0,200}notifyRoles/);
  });
  it("رسايل الترجرات بتتحوّل لأخطاء مفهومة", () => {
    for (const c of ["GL_PERIOD_NOT_ENDED", "GL_PERIOD_EARLIER_OPEN", "GL_PERIOD_LATER_CLOSED", "GL_PERIOD_REOPEN_REASON"]) expect(routes, c).toContain(c);
  });
});

describe("المنطق والأقفال", () => {
  it("الإقفال والفتح: قفل الدفتر ← صف الفترة FOR UPDATE ← فحص القواعد", () => {
    for (const fn of ["export async function closePeriod", "export async function reopenPeriod"]) {
      const f = slice(lib, fn);
      expect(f.indexOf("lockLedger"), fn).toBeGreaterThan(-1);
      expect(f.indexOf("lockLedger")).toBeLessThan(f.indexOf("loadLocked"));
      expect(f.indexOf("loadLocked")).toBeLessThan(f.indexOf("canClose") > -1 ? f.indexOf("canClose") : f.indexOf("canReopen"));
    }
    expect(lib).toMatch(/for update/);
  });
  it("كل إقفال وفتح ليه سجل وتدقيق، والفتح بسبب", () => {
    expect(lib).toContain("ledger.period_closed");
    expect(lib).toContain("ledger.period_reopened");
    expect(lib.match(/insert into gl_period_events/g)).toHaveLength(2);
    expect(slice(lib, "export async function reopenPeriod")).toContain("reopen_reason");
  });
  it("الإقفال بيقفل مهمة التذكير، والتذكير بمفتاح تكرار فيه رقم مرات الفتح", () => {
    expect(slice(lib, "export async function closePeriod")).toContain("closeTask");
    const r = slice(lib, "export async function ensureCloseReminder");
    expect(r).toContain("taskDedupeKey");
    expect(r).toContain("reopen_count");
    expect(r).toContain("executive_manager");
    expect(r).toContain("chairman");
  });
  it("التذكير على الـcron اليومي الموجود (من غير cron جديد)", () => {
    const h = read("src/routes/health.ts");
    expect(h).toContain("ensureCloseReminder");
    expect(slice(h, 'router.get("/cron/daily-brief"', "export default")).toContain("ensureCloseReminder");
  });
});

describe("الإعداد", () => {
  it("period.close_day رقم 1–28 افتراضي 5", () => {
    const d = SETTING_DEFS.find((x) => x.key === "period.close_day");
    expect(d?.default).toBe("5");
    expect(d && "min" in d ? d.min : null).toBe(1);
    expect(d && "max" in d ? d.max : null).toBe(28);
  });
});

describe("الهجرة 0107", () => {
  it("ترجر الفترة: الإقفال بعد نهاية الشهر وبالترتيب، والفتح بسبب وبالعكس", () => {
    for (const c of ["GL_PERIOD_NOT_ENDED", "GL_PERIOD_EARLIER_OPEN", "GL_PERIOD_LATER_CLOSED", "GL_PERIOD_REOPEN_REASON", "GL_PERIOD_IMMUTABLE", "GL_PERIOD_MUST_START_OPEN"]) expect(mig, c).toContain(c);
    expect(mig).toContain("Africa/Cairo");
  });
  it("السجل للإضافة بس وسبب الفتح إلزامي في CHECK", () => {
    expect(mig).toContain("GL_PERIOD_EVENT_IMMUTABLE");
    expect(mig).toMatch(/CHECK \("action" <> 'reopened' OR char_length\(btrim\(coalesce\("reason", ''\)\)\) >= 3\)/);
  });
  it("الترحيل بيقرا الفترة FOR SHARE (الإقفال بيستنى الترحيل الشغّال)", () => {
    expect(slice(mig, "gl_guard_entry_insert")).toContain("FOR SHARE");
  });
  it("فيها Rollback، ومفيش حذف للفترات", () => {
    expect(mig).toContain("Rollback");
    expect(mig).toMatch(/TG_OP = 'DELETE' THEN RAISE EXCEPTION 'GL_PERIOD_IMMUTABLE'/);
  });
});

describe("الواجهة", () => {
  const panel = read("web/src/staff/PeriodsPanel.tsx");
  it("النصوص من ملف النسخ ومسجّل، والتبويب مربوط", () => {
    expect(panel).toMatch(/import "\.\.\/copy\/periods"/);
    expect(panel.replace(/\/\/.*$/gm, "")).not.toMatch(/"[^"\n]*[؀-ۿ][^"\n]*"/);
    expect(read("web/src/copy/lazy-dicts.ts")).toContain("periods: periodsCopy");
    expect(read("web/src/staff/Ledger.tsx")).toContain("<PeriodsPanel");
  });
  it("زر الفتح على آخر فترة مقفولة بس، والإقفال بعد نهاية الشهر", () => {
    expect(panel).toContain("latestClosed");
    expect(panel).toContain("p.endsOn < today");
  });
  it("بيكلّم المسارات الصح", () => {
    for (const r of ["/ledger/period-events", "/ledger/periods/check", "/close`", "/reopen`"]) expect(panel, r).toContain(r);
  });
});
