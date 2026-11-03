-- 0091 — سجل التوقف بالماكينة (أساس OEE حقيقي) — الخطوة 37ب
--
-- production_downtimes كانت بتسجّل دقايق مكتوبة باليد على دفعة بس. دلوقتي:
--   machine_id  الماكينة اللي وقفت (من سجل الماكينات في البيانات الأساسية)
--   التوقف ممكن يبقى «مفتوح» (started_at من غير ended_at) لحد ما حد يقفله، والدقايق بتتحسب من الوقتين
--   batch_id / workflow_order_id بقوا اختياريين: ماكينة ممكن تعطل وهي مش شغالة على دفعة
--   توقف مفتوح واحد بس لكل ماكينة (فهرس فريد جزئي)
-- التسجيلات القديمة (دقايق بدون ماكينة) فاضلة زي ما هي وبتتحسب على الدفعة، ومابتدخلش في OEE الماكينة.
--
-- Rollback:
--   DROP INDEX IF EXISTS production_downtimes_one_open_per_machine;
--   DROP INDEX IF EXISTS production_downtimes_machine_idx;
--   ALTER TABLE production_downtimes DROP CONSTRAINT IF EXISTS production_downtimes_target_chk;
--   ALTER TABLE production_downtimes DROP COLUMN IF EXISTS machine_id;
--   (رجوع batch_id/workflow_order_id لـNOT NULL ممكن بس لو مفيش صفوف بلا دفعة)

ALTER TABLE "production_downtimes" ADD COLUMN IF NOT EXISTS "machine_id" integer REFERENCES "foundation_machines"("id") ON DELETE SET NULL;
ALTER TABLE "production_downtimes" ALTER COLUMN "batch_id" DROP NOT NULL;
ALTER TABLE "production_downtimes" ALTER COLUMN "workflow_order_id" DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'production_downtimes_target_chk') THEN
    ALTER TABLE "production_downtimes" ADD CONSTRAINT "production_downtimes_target_chk" CHECK ("batch_id" IS NOT NULL OR "machine_id" IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "production_downtimes_machine_idx" ON "production_downtimes" ("machine_id", "started_at");
CREATE UNIQUE INDEX IF NOT EXISTS "production_downtimes_one_open_per_machine"
  ON "production_downtimes" ("machine_id") WHERE "ended_at" IS NULL AND "machine_id" IS NOT NULL;
