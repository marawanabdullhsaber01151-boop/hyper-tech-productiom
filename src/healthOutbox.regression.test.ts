/** @format */
// «صحة النظام»: الرسائل الفاشلة بتتشخّص (السبب) وتتعالج (إعادة/تجاهل) بصلاحية وتدقيق، والفشل المتعوّض بقناة تانية مايتحسبش.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
const health = read("src/routes/health.ts");
const sys = read("src/lib/systemHealth.ts");
const route = health.split('"/admin/system-health/outbox"')[1]!.split("/** Vercel Cron")[0]!;

describe("علاج الرسائل الفاشلة", () => {
  it("المسار بصلاحية صحة النظام وبيتحقق من الإجراء", () => {
    expect(health).toMatch(/router\.post\(\s*"\/admin\/system-health\/outbox",\s*requireAuth,\s*requireRole\(\.\.\.ACCESS\.systemHealthRead\)/);
    expect(route).toMatch(/"retry"/);
    expect(route).toMatch(/"dismiss"/);
    expect(route).toContain("400");
  });
  it("بيلمس الفاشل نهائيًا (dead) بس، وعلى طول جوه معاملة وبتدقيق", () => {
    const updates = route.match(/UPDATE outbox_events[^`]*/g) ?? [];
    expect(updates).toHaveLength(2);
    for (const u of updates) expect(u).toContain("WHERE status = 'dead'");
    expect(route).toContain("db.transaction");
    expect(route).toContain("writeAuditEvent");
    expect(route).toContain("outbox.dead_retried");
    expect(route).toContain("outbox.dead_dismissed");
  });
  it("التجاهل مابيمسحش (بيقفل كـ done ويسجّل السبب) والإعادة بتصفّر المحاولات", () => {
    expect(route).not.toMatch(/DELETE FROM/);
    expect(route).toContain("status = 'done'");
    expect(route).toContain("attempts = 0");
  });
});

describe("تشخيص الفحوصات", () => {
  it("فحص الرسائل للعملاء مايحسبش الفشل اللي اتعوّض بقناة تانية", () => {
    const blk = sys.split('id: "messages_failed"')[1]!.split("// ─────")[0]!;
    expect(blk).toContain("NOT EXISTS");
    expect(blk).toContain("s.status = 'sent'");
    expect(blk).toContain("summarizeFailures");
    expect(blk).toContain("configHint");
  });
  it("فحص الصادر بيعرض سبب الفاشل", () => {
    const blk = sys.split('id: "outbox"')[1]!.split("id: \"human_tasks\"")[0]!;
    expect(blk).toContain("summarizeDead");
    expect(blk).toContain("last_error");
  });
});
