-- 0094 — عدد القطع في الكرتونة وقت الطلب — الخطوة 42ب
--
-- أمر الإنتاج بيتخزّن بالقطع (الوحدة الأساسية). العمود ده بيسجّل «الكرتونة كانت كام قطعة» لحظة الطلب، عشان
-- المبيعات والمصنع والعميل يشوفوا الطلب بالكراتين والقطع حتى لو التحويل اتغيّر بعد كده في البيانات الأساسية.
-- NULL = المنتج مالوش كرتونة صالحة وقت الطلب. الأوامر القديمة فاضلة NULL وبتتعرض بالقطع زي ما هي.
--
-- Rollback:
--   ALTER TABLE production_workflow_orders DROP COLUMN IF EXISTS pieces_per_carton;

ALTER TABLE "production_workflow_orders" ADD COLUMN IF NOT EXISTS "pieces_per_carton" integer;
