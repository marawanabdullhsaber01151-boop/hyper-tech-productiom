/** @format */
import { describe, expect, it } from "vitest";
import { backupHealth, backupObjectKey, compareRowCounts, manifestKeyFor, parseBackupKey, planRetention, pruneIsSafe, type LastRun } from "./backupCore";

const at = (s: string) => new Date(s);
const key = (s: string) => backupObjectKey(at(s));
const NOW = at("2026-10-29T12:00:00Z");

describe("أسماء الملفات", () => {
  it("اسم الملف ذهابًا وإيابًا، والملحقات", () => {
    const k = backupObjectKey(at("2026-10-29T00:30:05Z"));
    expect(k).toBe("daily/hypertech-20261029T003005Z.dump.age");
    expect(parseBackupKey(k)?.toISOString()).toBe("2026-10-29T00:30:05.000Z");
    expect(manifestKeyFor(k)).toBe("daily/hypertech-20261029T003005Z.manifest.json");
  });
  it("أسماء مش بتاعتنا أو تاريخ مستحيل = null", () => {
    for (const k of ["README.txt", "daily/other.dump.age", "daily/hypertech-20261340T000000Z.dump.age", "daily/hypertech-20260230T000000Z.dump.age"]) expect(parseBackupKey(k)).toBeNull();
  });
});

describe("سياسة الاحتفاظ", () => {
  const daily = Array.from({ length: 120 }, (_, i) => key(new Date(NOW.getTime() - i * 86_400_000 - 3_600_000 * 11).toISOString()));
  it("بتحتفظ بـ14 يوم + الآحاد 8 أسابيع + أول الشهر 12 شهر، وتمسح الباقي", () => {
    const { keep, prune } = planRetention(daily, NOW);
    expect(keep.length + prune.length).toBe(120);
    const ageDays = (k: string) => (NOW.getTime() - parseBackupKey(k)!.getTime()) / 86_400_000;
    for (const k of daily.filter((k) => ageDays(k) <= 14)) expect(keep).toContain(k);
    const old = prune.map(ageDays);
    expect(Math.min(...old)).toBeGreaterThan(14);
    for (const k of keep.filter((k) => ageDays(k) > 14)) {
      const d = parseBackupKey(k)!;
      expect(d.getUTCDay() === 0 || d.getUTCDate() === 1).toBe(true);
    }
    expect(keep.length).toBeLessThan(40);
  });
  it("آخر 3 نسخ دايمًا حتى لو قديمة جدًا", () => {
    const keys = [key("2025-01-01T00:00:00Z"), key("2025-01-02T00:00:00Z"), key("2025-01-03T00:00:00Z"), key("2025-01-04T00:00:00Z")];
    const { keep, prune } = planRetention(keys, NOW);
    expect(keep).toEqual([keys[3], keys[2], keys[1]]);
    expect(prune).toEqual([keys[0]]);
  });
  it("المفاتيح الغريبة ما بتتمسحش ولا بتتحسب", () => {
    const { keep, prune } = planRetention(["daily/notes.txt", key("2020-01-01T00:00:00Z")], NOW);
    expect(keep).toEqual([key("2020-01-01T00:00:00Z")]);
    expect(prune).toEqual([]);
  });
  it("حارس المسح: لا يزيد عن النص", () => {
    expect(pruneIsSafe(10, 5)).toBe(true);
    expect(pruneIsSafe(10, 6)).toBe(false);
    expect(pruneIsSafe(0, 0)).toBe(true);
  });
});

describe("مقارنة عدد الصفوف", () => {
  it("متطابق", () => {
    const c = { a: 10, b: 0 };
    const r = compareRowCounts(c, c, { a: 10, b: 0 });
    expect(r).toMatchObject({ ok: true, tables: 2, rows: 10 });
  });
  it("كتابة أثناء النسخ: القيمة بين العدّين مقبولة، خارجهم لأ", () => {
    expect(compareRowCounts({ a: 10 }, { a: 12 }, { a: 11 }).ok).toBe(true);
    const bad = compareRowCounts({ a: 10 }, { a: 12 }, { a: 9 });
    expect(bad.ok).toBe(false);
    expect(bad.diffs[0]).toEqual({ table: "a", restored: 9, min: 10, max: 12 });
  });
  it("جدول ناقص من المسترجع = فشل، وجدول زيادة من غير سجل = فشل", () => {
    expect(compareRowCounts({ a: 1, b: 2 }, { a: 1, b: 2 }, { a: 1 }).diffs).toEqual([{ table: "b", restored: null, min: 2, max: 2 }]);
    expect(compareRowCounts({ a: 1 }, { a: 1 }, { a: 1, extra: 3 }).ok).toBe(false);
  });
});

describe("فحص صحة النظام للنسخ", () => {
  const run = (o: Partial<LastRun>): LastRun => ({ kind: "backup", store: "r2", status: "ok", finishedAt: at("2026-10-29T03:00:00Z"), sizeBytes: 5_242_880, ...o });
  it("لا نسخ = تنبيه بالدليل", () => {
    const r = backupHealth([], NOW);
    expect(r.status).toBe("warn");
    expect(r.action).toContain("backup-restore.md");
  });
  it("نسخة حديثة + اختبار استرجاع حديث = سليم", () => {
    const r = backupHealth([run({}), run({ kind: "restore_test", finishedAt: at("2026-10-26T03:00:00Z") })], NOW);
    expect(r.status).toBe("ok");
    expect(r.message).toContain("Cloudflare R2");
    expect(r.message).toContain("5.0 م.ب");
  });
  it("نسخة سليمة بلا اختبار استرجاع = تنبيه", () => {
    expect(backupHealth([run({})], NOW).status).toBe("warn");
  });
  it("تأخّر النسخة: 36 ساعة تنبيه، 72 خطر", () => {
    const test = run({ kind: "restore_test" });
    expect(backupHealth([run({ finishedAt: at("2026-10-27T23:00:00Z") }), test], NOW).status).toBe("warn");
    expect(backupHealth([run({ finishedAt: at("2026-10-25T00:00:00Z") }), test], NOW).status).toBe("bad");
  });
  it("فشل في مخزن واحد = خطر مع السبب", () => {
    const r = backupHealth([run({}), run({ store: "b2", status: "failed", error: "AccessDenied" })], NOW);
    expect(r.status).toBe("bad");
    expect(r.examples?.[0]).toContain("AccessDenied");
  });
  it("فشل اختبار الاسترجاع أو قدمه = خطر", () => {
    expect(backupHealth([run({}), run({ kind: "restore_test", status: "failed" })], NOW).status).toBe("bad");
    expect(backupHealth([run({}), run({ kind: "restore_test", finishedAt: at("2026-10-01T00:00:00Z") })], NOW).status).toBe("bad");
    expect(backupHealth([run({}), run({ kind: "restore_test", finishedAt: at("2026-10-15T00:00:00Z") })], NOW).status).toBe("warn");
  });
});
