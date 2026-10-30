/** @format */
// حراسة بالنص: كل ما اتفق عليه في الخطوة 30 (ADR 0007) فعلًا موصّل في الكود.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("الخطوة 30 — المهام البشرية والـsaga", () => {
  it("التصعيد والـsaga بيتشغلوا من مسار تصريف الصندوق ومن الـcron اليومي (من غير cron جديد في Vercel)", () => {
    expect(read("src/routes/health.ts")).toMatch(/runEscalations/);
    expect(read("src/routes/health.ts")).toMatch(/drainSagas/);
    expect(read("src/routes/chat-staff.ts")).toMatch(/runEscalations/);
    const crons = (JSON.parse(read("vercel.json")).crons ?? []) as unknown[];
    expect(crons.length).toBeLessThanOrEqual(2);
  });
  it("التصعيد: معاملة لكل مهمة بقفل SKIP LOCKED، والتغيير والسجل والإشعار في نفس المعاملة", () => {
    const src = read("src/lib/humanTasks.ts");
    expect(src).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(src).toMatch(/executor: tx/);
    expect(src).not.toMatch(/DELETE FROM human_tasks/);
  });
  it("الـsaga: خطوة في معاملة بقفل، ومفيش حذف", () => {
    const src = read("src/lib/sagas.ts");
    expect(src).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(src).not.toMatch(/DELETE FROM saga_instances/);
  });
  it("مسارات المهام: الإسناد وإعادة التوزيع بصلاحية tasks.assign والإجراء مسجّل", () => {
    const src = read("src/routes/tasks.ts");
    expect(src).toMatch(/requirePermission\("tasks\.assign"\)/);
    expect(read("src/lib/actionRegistry.ts")).toMatch(/key: "tasks\.assign"/);
    expect(read("src/main.ts")).toMatch(/apiRouter\.use\(tasksRouter\)/);
  });
  it("الجداول والمهاجرة 0087 موجودة وفيها rollback ومنع التكرار", () => {
    const m = read("migrations/0087_human_tasks_sagas.sql");
    for (const t of ["human_tasks", "human_task_events", "saga_instances"]) expect(m).toContain(`CREATE TABLE IF NOT EXISTS "${t}"`);
    expect(m).toMatch(/Rollback/);
    expect(m).toMatch(/human_tasks_dedupe_unique/);
  });
  it("فحص صحة النظام للمهام موجود", () => {
    expect(read("src/lib/systemHealth.ts")).toMatch(/id: "human_tasks"/);
  });
});
