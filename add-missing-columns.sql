-- ============================================================
-- سكريبت SQL يدوي — إضافة الأعمدة الجديدة اللي ضيفناها في الجلسة دي
-- بديل آمن لـ "npm run db:push" اللي فشل بمشكلة primary key معروفة
-- شغّل السكريبت ده مرة واحدة على قاعدة البيانات الحقيقية (Railway Postgres)
-- ============================================================

-- 1) أعمدة "التسليم بخطوتين" في جدول أوامر الإنتاج
ALTER TABLE production_workflow_orders
  ADD COLUMN IF NOT EXISTS pending_delivery_inventory_item_id integer,
  ADD COLUMN IF NOT EXISTS pending_delivery_add_to_inventory boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_initiated_by_id integer,
  ADD COLUMN IF NOT EXISTS delivery_initiated_by_name text,
  ADD COLUMN IF NOT EXISTS delivery_initiated_at timestamptz;

-- 2) أعمدة "المورد ووقت التوريد" في جدول المخزون
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS supplier_id integer,
  ADD COLUMN IF NOT EXISTS lead_days integer;

-- 3) index على المورد (لتسريع البحث/الفلترة بالمورد)
CREATE INDEX IF NOT EXISTS inventory_supplier_idx ON inventory_items (supplier_id);

-- ============================================================
-- تأكيد نهائي: اعرض بنية الجدولين بعد التعديل للتأكد
-- ============================================================
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'production_workflow_orders'
  AND column_name IN (
    'pending_delivery_inventory_item_id',
    'pending_delivery_add_to_inventory',
    'delivery_initiated_by_id',
    'delivery_initiated_by_name',
    'delivery_initiated_at'
  );

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'inventory_items'
  AND column_name IN ('supplier_id', 'lead_days');
