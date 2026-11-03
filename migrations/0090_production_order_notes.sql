-- 0090 — ملاحظات المشرف على أمر الإنتاج — الخطوة 37أ
--
-- production_order_notes: ملاحظة بنوع (ملاحظة، مشكلة، تعليمات، تسليم وردية) على أمر إنتاج (واختياريًا دفعة).
--   سجل إضافة فقط (مفيش تعديل ولا حذف) عشان يتتبع مين قال إيه ومتى. وهي كمان بتحسب «نشاط» على الأمر
--   فالمرحلة اللي حد بيكتب عنها مش بتتعدّ واقفة.
-- تنبيه المرحلة الواقفة بيتحسب من البيانات الموجودة (آخر نشاط على الأمر) من غير جدول إضافي، وبيتحوّل لمهمة بشرية بتصعيد.
-- ما بيلمسش أي بيانات موجودة.
--
-- Rollback:
--   DROP TABLE IF EXISTS production_order_notes;

CREATE TABLE IF NOT EXISTS "production_order_notes" (
  "id" serial PRIMARY KEY NOT NULL,
  "workflow_order_id" integer NOT NULL REFERENCES "production_workflow_orders"("id"),
  "batch_id" integer REFERENCES "production_batches"("id"),
  "kind" text NOT NULL DEFAULT 'observation'
    CHECK ("kind" IN ('observation', 'issue', 'instruction', 'handover')),
  "body" text NOT NULL CHECK (char_length(btrim("body")) >= 3),
  "created_by" integer NOT NULL REFERENCES "system_users"("id"),
  "created_by_name" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "production_order_notes_order_idx" ON "production_order_notes" ("workflow_order_id", "created_at" DESC);
