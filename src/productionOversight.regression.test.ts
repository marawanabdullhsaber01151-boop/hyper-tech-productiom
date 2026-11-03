/** @format */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const route = read("./routes/production-oversight.ts");

describe("خطوة 37أ — متابعة الإنتاج", () => {
  it("إضافة الملاحظة بالأدوار، معاملة واحدة مع قفل الأمر والتدقيق", () => {
    const i = route.indexOf('router.post("/production-oversight/orders/:id/notes"');
    expect(i).toBeGreaterThan(-1);
    const h = route.slice(i, i + 2600);
    expect(h).toContain("requireRole(...NOTE_WRITE_ROLES)");
    expect(h).toContain("db.transaction");
    expect(h).toContain('.for("update")');
    expect(h).toContain("writeAuditEvent");
  });

  it("القراءة بأدوار القراءة، والراوتر متركّب", () => {
    expect(route).toContain("requireRole(...NOTE_READ_ROLES)");
    const main = read("./main.ts");
    expect(main).toContain('import productionOversightRouter from "./routes/production-oversight"');
    expect(main).toContain("apiRouter.use(productionOversightRouter)");
  });

  it("الملاحظات سجل إضافة فقط: مفيش تعديل ولا حذف", () => {
    expect(route).not.toContain("router.patch");
    expect(route).not.toContain("router.delete");
    expect(route).not.toContain("router.put");
  });

  it("عامل الـ15 دقيقة بيفحص الأوامر الواقفة وفشله مايوقفش الباقي", () => {
    const h = read("./routes/health.ts");
    expect(h).toContain("scanStalledOrders().catch(() => null)");
  });

  it("المهمة التلقائية بمفتاح منع تكرار ومسؤول وتصعيد", () => {
    const l = read("./lib/productionOversight.ts");
    expect(l).toContain("dedupeKey: stallDedupeKey");
    expect(l).toContain("escalateToRole: owner.escalateTo");
    expect(l).toContain("assigneeRole: owner.role");
  });

  it("الهجرة 0090", () => {
    const sql = read("../migrations/0090_production_order_notes.sql");
    for (const s of ["production_order_notes", "'handover'", "Rollback", "char_length"]) expect(sql).toContain(s);
  });
});
