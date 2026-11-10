-- 0097 — تثبيت وعد التسليم على حالة التشغيل (الخطوة 44ب)
--
-- سجل إضافة فقط (append-only): أول تثبيت لحالة = «الوعد الأول» وما بيتغيّرش أبدًا. أي تثبيت بعده بيتسجّل
-- كصف جديد بسبب إجباري، والوعد الحالي = آخر صف. مفيش تحديث ولا حذف على الصفوف من التطبيق.
--
-- Rollback:
--   DROP TABLE IF EXISTS operations_case_promises;

CREATE TABLE IF NOT EXISTS "operations_case_promises" (
  "id" serial PRIMARY KEY,
  "case_id" integer NOT NULL REFERENCES "operations_cases"("id") ON DELETE CASCADE,
  "promised_date" date NOT NULL,
  "earliest_date" date,
  "likely_date" date,
  "latest_date" date,
  "confidence_percent" integer,
  "method" text NOT NULL,
  "runs" integer NOT NULL DEFAULT 0,
  "due_date" date,
  "reason" text,
  "created_by" integer REFERENCES "system_users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "operations_case_promises_case_idx" ON "operations_case_promises" ("case_id", "id");
