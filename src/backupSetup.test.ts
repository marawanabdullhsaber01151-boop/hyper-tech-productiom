/** @format */
/**
 * الخطوة 28: حراسة إعداد النسخ الاحتياطي (نصوص السكربتات والـworkflows والهجرة).
 * بيمسك الأخطاء اللي بتخلي النسخ «شغّال» وهو في الحقيقة مش آمن أو مش بيتجرّب:
 * رفع قبل التشفير، المفتاح الخاص في وظيفة النسخ، set -e معطّل، استرجاع على قاعدة حقيقية…
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("هجرة 0084 وفحص الصحة", () => {
  it("جدول backup_runs بأنواع وحالات مقيّدة وبـrollback مكتوب", () => {
    const sql = read("migrations/0084_backup_runs.sql");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "backup_runs"');
    expect(sql).toContain("'backup', 'restore_test'");
    expect(sql).toContain("'ok', 'failed'");
    expect(sql).toContain("Rollback");
    expect(sql).not.toMatch(/DROP\s+TABLE\s+(?!IF EXISTS backup_runs)/);
    const nums = readdirSync(resolve(root, "migrations")).filter((f) => /^\d{4}/.test(f)).map((f) => f.slice(0, 4));
    expect(nums.filter((n) => n === "0084").length).toBe(1);
  });

  it("فحص «backups» مسجّل في صفحة صحة النظام", () => {
    expect(read("src/lib/systemHealth.ts")).toContain('id: "backups",\n    group: "base",');
  });

  it("الـcrons على Vercel لسه اتنين بس (النسخ بيشتغل من GitHub Actions)", () => {
    const v = JSON.parse(read("vercel.json")) as { crons: unknown[] };
    expect(v.crons.length).toBe(2);
  });
});

describe("سكربتات النسخ", () => {
  const files = ["backup.sh", "upload-store.sh", "restore-test.sh", "restore-store.sh"].map((f) => `scripts/backup/${f}`);
  it("كلها set -euo pipefail ومفيش set +e، وصياغة bash سليمة (الأمر نفسه اتفحص بـbash -n في التسليم)", () => {
    for (const f of files) {
      const s = read(f);
      expect(s).toContain("set -euo pipefail");
      expect(s).not.toContain("set +e");
    }
  });

  it("التشفير قبل أي رفع، والنسخة غير المشفّرة بتتمسح، والمفتاح العام بس في وظيفة النسخ", () => {
    const s = read("scripts/backup/backup.sh");
    expect(s.indexOf("age -r")).toBeGreaterThan(0);
    expect(s.indexOf("age -r")).toBeLessThan(s.indexOf("upload-store.sh"));
    expect(s).toContain('shred -u "$work/db.dump"');
    expect(s).toContain("BACKUP_AGE_PUBLIC_KEY");
    expect(s).not.toContain("PRIVATE");
    expect(read("scripts/backup/upload-store.sh")).not.toContain("db.dump\"");
  });

  it("كل مخزن في عملية منفصلة (عشان set -e يشتغل جواها) والفشل بيتسجّل وبيوقّف الـworkflow", () => {
    const s = read("scripts/backup/backup.sh");
    expect(s).toContain('bash scripts/backup/upload-store.sh "$store"');
    expect(s).toContain("record_run backup failed");
    expect(s).toContain('[ "$failed" = 0 ] || die');
  });

  it("الاسترجاع بيرفض قاعدة حقيقية، وبيتأكد من البصمة والحجم والصفوف وآخر تحديث هيكل", () => {
    const t = read("scripts/backup/restore-test.sh");
    expect(t).toContain("RESTORE_ADMIN_URL");
    expect(t).toContain("neon.tech");
    const r = read("scripts/backup/restore-store.sh");
    for (const needle of ["sha256", "sizeBytes", "compare-counts.ts", "_migrations_applied", "age -d"]) expect(r).toContain(needle);
  });

  it("سياسة الاحتفاظ بتتنفّذ من الكود المختبَر ومبتمسحش بدون حارس", () => {
    const u = read("scripts/backup/upload-store.sh");
    expect(u).toContain("scripts/backup/prune.ts");
    expect(read("scripts/backup/prune.ts")).toContain("pruneIsSafe");
  });
});

describe("workflows GitHub", () => {
  it("backup يومي ومعاه تشغيل يدوي، والمفتاح الخاص مش فيه", () => {
    const y = read(".github/workflows/backup.yml");
    expect(y).toContain("workflow_dispatch");
    expect(y).toMatch(/cron: "30 0 \* \* \*"/);
    expect(y).not.toContain("PRIVATE");
    expect(y).toContain("BACKUP_AGE_PUBLIC_KEY");
  });

  it("restore-test أسبوعي بقاعدة مؤقتة والمفتاح الخاص فيه هو بس", () => {
    const y = read(".github/workflows/restore-test.yml");
    expect(y).toMatch(/cron: "0 2 \* \* 0"/);
    expect(y).toContain("image: postgres:17");
    expect(y).toContain("secrets.BACKUP_AGE_PRIVATE_KEY");
    expect(y).toContain("RESTORE_ADMIN_URL: postgres://postgres:ci@localhost");
  });

  it("مفيش أي سر بيتطبع، ومفيش workflow بيرفع المفتاح الخاص كـartifact", () => {
    for (const f of ["backup.yml", "restore-test.yml"]) {
      const y = read(`.github/workflows/${f}`);
      expect(y).not.toMatch(/echo\s+.*secrets\./);
      expect(y).not.toContain("upload-artifact");
    }
  });

  it("إصدار Postgres واحد في الـworkflows والـaction والخدمة", () => {
    const a = read(".github/actions/setup-backup-tools/action.yml");
    expect(a).toContain('default: "17"');
    expect(read(".github/workflows/backup.yml")).toContain('PG_MAJOR: "17"');
    expect(read(".github/workflows/restore-test.yml")).toContain('PG_MAJOR: "17"');
  });

  it("الدليل موجود، و.gitignore بيمنع النسخ والمفاتيح", () => {
    expect(existsSync(resolve(root, "docs/runbooks/backup-restore.md"))).toBe(true);
    const g = read(".gitignore");
    for (const p of ["*.dump", "*.dump.age", "age-key*.txt"]) expect(g).toContain(p);
  });
});
