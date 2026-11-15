-- 0102 — متوسط التكلفة المرجّح للمخزون + حساب تكلفة البضاعة المباعة (الخطوة 49ب)
--
-- avg_cost: بيتحسب من المشتريات المقبولة بعد الفحص (متوسط مرجّح)، 4 خانات عشرية عشان التقريب ميتراكمش.
-- الصفر معناه «لسه ملهوش تكلفة» (مش تكلفة صفر)، وبيتعدّ غير مقيَّم في التقارير.
-- حساب 5150 تكلفة البضاعة المباعة: الحساب الوحيد اللي بتتقيّد عليه تكلفة البيع التلقائية عند الشحن.
--
-- Rollback:
--   DELETE FROM gl_accounts WHERE code = '5150' AND NOT EXISTS (SELECT 1 FROM gl_journal_lines l WHERE l.account_id = gl_accounts.id);
--   ALTER TABLE inventory_items DROP COLUMN IF EXISTS avg_cost;

ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "avg_cost" numeric(14,4) NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_items_avg_cost_nonneg') THEN
    ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_avg_cost_nonneg" CHECK ("avg_cost" >= 0);
  END IF;
END $$;

INSERT INTO "gl_accounts" ("code","name","type","normal_side","is_postable","is_system","parent_id")
SELECT '5150','تكلفة البضاعة المباعة','expense','debit',true,true,(SELECT id FROM "gl_accounts" WHERE code = '5100')
ON CONFLICT ("code") DO NOTHING;
