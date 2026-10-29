-- 0084 — سجل تشغيلات النسخ الاحتياطي واختبار الاسترجاع (الخطوة 28)
--
-- سكربتات GitHub Actions (scripts/backup/record-run.ts) بتسجّل هنا كل نسخة وكل اختبار استرجاع،
-- وصفحة «صحة النظام» بتقرا آخر تشغيلة لكل (نوع، مخزن) وتقول لو النسخ واقف أو الاسترجاع ما اتجرّبش.
-- التسجيل بيحصل بعد أخذ النسخة، فمفيش نسخة بتحتوي سجل نفسها.
-- ما بيلمسش أي بيانات موجودة.
--
-- Rollback:
--   DROP TABLE IF EXISTS backup_runs;

CREATE TABLE IF NOT EXISTS "backup_runs" (
  "id" serial PRIMARY KEY NOT NULL,
  "kind" text NOT NULL CHECK ("kind" IN ('backup', 'restore_test')),
  "status" text NOT NULL CHECK ("status" IN ('ok', 'failed')),
  "store" text NOT NULL,
  "object_key" text,
  "size_bytes" bigint,
  "sha256" text,
  "row_counts" jsonb,
  "tables_count" integer,
  "rows_total" bigint,
  "error" text,
  "started_at" timestamptz,
  "finished_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "backup_runs_kind_store_idx" ON "backup_runs" ("kind", "store", "finished_at" DESC);
