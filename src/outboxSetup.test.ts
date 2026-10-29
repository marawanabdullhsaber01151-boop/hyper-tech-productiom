/** @format */
/**
 * الخطوة 29: حراسة تركيب صندوق الصادر المضمون (نصوص الكود والهجرة والـworkflow).
 * بيمسك: ثغرة تكرار الرسالة، إشعار بيكسر الطلب بعد ما اتسجّل، عامل من غير قفل، cron تالت على Vercel…
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { OUTBOX_TYPES } from "./lib/outboxCore";

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("هجرة 0085", () => {
  const sql = read("migrations/0085_outbox_events.sql");
  it("جدول outbox_events: حالات مقيّدة، مفتاح منع تكرار فريد جزئي، فهرس المستحق، وrollback", () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "outbox_events"');
    expect(sql).toContain("'pending', 'done', 'dead'");
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "outbox_events_dedupe_unique"');
    expect(sql).toContain('WHERE "dedupe_key" IS NOT NULL');
    expect(sql).toContain('"outbox_events_due_idx"');
    expect(sql).toContain("Rollback");
  });
  it("الكتابة بتستخدم نفس الشرط الجزئي في ON CONFLICT", () => {
    expect(read("src/lib/outbox.ts")).toContain("ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING");
  });
});

describe("العامل", () => {
  const src = read("src/lib/outbox.ts");
  it("كل حدث في معاملة لوحده بقفل SKIP LOCKED، والمعالج جواها", () => {
    expect(src).toContain("FOR UPDATE SKIP LOCKED");
    expect(src.indexOf("db.transaction")).toBeLessThan(src.indexOf("await handler(tx"));
    expect(src.indexOf("await handler(tx")).toBeLessThan(src.indexOf("SET status = 'done'"));
  });
  it("لكل نوع حدث معالج، ومفيش معالج زيادة", () => {
    const h = read("src/lib/outboxHandlers.ts");
    const keys = [...h.matchAll(/^\s+"([a-z.]+)": /gm)].map((m) => m[1]).filter((k) => k !== undefined && k.includes("."));
    expect([...new Set(keys)].sort()).toEqual([...OUTBOX_TYPES].sort());
  });
  it("القاعدة بتتستورد بالكسل (الملف بيتختبر من غير DATABASE_URL)", () => {
    expect(src).not.toMatch(/^import \{ db \} from/m);
    expect(src).toContain('await import("../db")');
  });
});

describe("الإشعارات", () => {
  const n = read("src/lib/notifications.ts");
  it("من غير executor: ما بترميش، بتسجّل وتحط الإشعار في الصندوق", () => {
    expect(n).toContain("durable(");
    expect(n).toContain('type: "notify.user"');
    expect(n).toContain('type: "notify.role"');
    expect(n).toContain("logger.error");
  });
  it("مع executor (معاملة): بتكتب جواها وبترمي الفشل للمستدعي", () => {
    expect(n).toContain("if (opts.executor) return insertForUser(opts.executor");
    expect(n).toContain("if (opts.executor) return insertForRole(opts.executor");
  });
  it("الواجهات القديمة ما اتغيّرتش (notifyUser/notifyRole/notifyRoles)", () => {
    for (const f of ["notifyUser", "notifyRole", "notifyRoles"]) expect(n).toContain(`export async function ${f}(`);
  });
});

describe("تنبيهات الأمان", () => {
  it("بتتكتب في الصندوق بمفتاح منع تكرار (واحد في الساعة)، والمستدعين بيستنوها (مش void)", () => {
    const d = read("src/lib/channels/deliver.ts");
    expect(d).toContain('type: "portal.alert"');
    expect(d).toContain('dedupeKey("alert", userId, template, hourBucket(new Date()))');
    for (const f of ["src/routes/portal-recovery.ts", "src/routes/portal.ts"]) {
      const s = read(f);
      expect(s).not.toContain("void sendSecurityAlert");
      expect(s).toContain("await sendSecurityAlert");
    }
  });
});

describe("التشغيل", () => {
  it("مسار /cron/outbox-drain محمي بـassertCronAuth قبل أي شغل، ومتصنّف في allowlist", () => {
    const h = read("src/routes/health.ts");
    const i = h.indexOf('router.get("/cron/outbox-drain"');
    expect(i).toBeGreaterThan(0);
    const body = h.slice(i, i + 400);
    expect(body.indexOf("assertCronAuth(req)")).toBeGreaterThan(0);
    expect(body.indexOf("assertCronAuth(req)")).toBeLessThan(body.indexOf("drainOutbox"));
    expect(read("docs/api-routes-allowlist.json")).toContain("GET /cron/outbox-drain");
  });
  it("الـcrons اليومية بتصرّف الصندوق كاحتياطي، ومفيش cron تالت على Vercel", () => {
    expect(read("src/routes/health.ts")).toContain("await drainOutbox({ limit: 50");
    expect(read("src/routes/chat-staff.ts")).toContain("await drainOutbox({ limit: 50");
    const v = JSON.parse(read("vercel.json")) as { crons: unknown[] };
    expect(v.crons.length).toBe(2);
  });
  it("workflow كل 15 دقيقة، بيتخطى بتحذير لو الأسرار ناقصة، والسر في الهيدر بس", () => {
    const y = read(".github/workflows/outbox-drain.yml");
    expect(y).toMatch(/cron: "\*\/15 \* \* \* \*"/);
    expect(y).toContain("secrets.APP_BASE_URL");
    expect(y).toContain("secrets.CRON_SECRET");
    expect(y).toContain("::warning::");
    expect(y).toContain('-H "Authorization: Bearer ${CRON_SECRET}"');
    expect(y).not.toMatch(/\?.*CRON_SECRET/);
  });
  it("فحص «outbox» مسجّل في صحة النظام", () => {
    expect(read("src/lib/systemHealth.ts")).toContain('id: "outbox",\n    group: "base",');
  });
});
