-- 0083 — حجز خامات الخطط المعتمدة (م3ب مركز قيادة التشغيل)
--
-- لما خطة تشغيل تتعتمد، الخامات المتاحة اللي محتاجاها بتتحجز (reserved_qty في الصنف) عشان خطة أو فاتورة تانية
-- ما تاخدهاش. الجدول ده بيسجّل كل حجز: كام اتحجز وكام اتصرف فعلًا (لما التشغيل يستلم من المخزن)
-- وحالته: active → consumed (اتصرف كله) أو released (اتحرر يدوي أو لإن خطة أحدث اتعتمدت).
-- ما بيلمسش أي بيانات موجودة.
--
-- Rollback:
--   -- حرّر الحجوزات النشطة الأول (UPDATE inventory_items SET reserved_qty = reserved_qty - remaining) لو فيه
--   DROP TABLE IF EXISTS operations_plan_reservations;

CREATE TABLE IF NOT EXISTS "operations_plan_reservations" (
  "id" serial PRIMARY KEY NOT NULL,
  "plan_id" integer NOT NULL REFERENCES "operations_plans"("id") ON DELETE CASCADE,
  "inventory_item_id" integer NOT NULL,
  "qty" numeric(14,3) NOT NULL,
  "consumed_qty" numeric(14,3) NOT NULL DEFAULT '0',
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "released_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "operations_plan_reservations_plan_idx" ON "operations_plan_reservations" ("plan_id", "status");
CREATE INDEX IF NOT EXISTS "operations_plan_reservations_item_idx" ON "operations_plan_reservations" ("inventory_item_id", "status");
