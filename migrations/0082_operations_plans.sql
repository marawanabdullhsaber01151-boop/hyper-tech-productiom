-- 0082 — خطط التشغيل المحفوظة (م3 مركز قيادة التشغيل)
--
-- قبل كده تحليل الاحتياج كان للعرض بس ومفيش مكان تتحفظ فيه الخطة ولا تتعتمد. الجدول ده بيحفظ لقطة الخطة
-- وقت إنشائها (بنود، تخصيص من المخزون، خامات، عجز) مع قيمة العجز ومستوى الاعتماد المطلوب.
-- الحالات: draft → submitted → approved أو rejected، وsuperseded لما تتحفظ خطة أحدث لنفس أمر البيع.
-- ما بيلمسش أي بيانات موجودة، ومفيش مخزون بيتحجز ولا إنتاج بيتنشأ من الخطة.
--
-- Rollback:
--   DROP TABLE IF EXISTS operations_plans;
--   DELETE FROM phase0_number_sequences WHERE sequence_key = 'operations_plan';

INSERT INTO "phase0_number_sequences" ("sequence_key", "prefix", "next_value", "padding")
VALUES ('operations_plan', 'PLN-', 1, 6)
ON CONFLICT ("sequence_key") DO NOTHING;

CREATE TABLE IF NOT EXISTS "operations_plans" (
  "id" serial PRIMARY KEY NOT NULL,
  "plan_number" text NOT NULL UNIQUE,
  "sales_order_id" integer NOT NULL,
  "case_id" integer,
  "status" text NOT NULL DEFAULT 'draft',
  "snapshot" jsonb NOT NULL,
  "shortage_value" numeric(14,2) NOT NULL DEFAULT '0',
  "approval_level" integer NOT NULL DEFAULT 0,
  "notes" text,
  "created_by" integer NOT NULL,
  "created_by_name" text,
  "submitted_by" integer,
  "submitted_at" timestamptz,
  "decided_by" integer,
  "decided_by_name" text,
  "decided_at" timestamptz,
  "decision_note" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "operations_plans_order_idx" ON "operations_plans" ("sales_order_id", "status");
CREATE INDEX IF NOT EXISTS "operations_plans_status_idx" ON "operations_plans" ("status", "created_at" DESC);
