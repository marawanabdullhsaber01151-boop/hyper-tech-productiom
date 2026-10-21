-- 0080 — تصحيح قناة الفواتير القديمة (أونلاين/أوفلاين)
--
-- الخلل: طلبات بوابة العملاء كانت بتتسجّل فواتير بقناة «direct» (أوفلاين) بالغلط، فكانت بتظهر وسط
-- فواتير الأوفلاين. الكود اتصلّح (القناة «website»)، وده بيصلّح القديم:
--   ١) فواتير البوابة (بتتعرف من علامة الملاحظات التلقائية) ← website
--   ٢) فواتير بائع الأونلاين ← website، وبائع الأوفلاين ← direct
-- ما بيلمسش أي رقم مالي أو حالة. idempotent (تشغيله تاني ما يغيّرش حاجة).
--
-- Rollback: مفيش رجوع آلي (القيمة القديمة كانت غلط أصلًا). لو لزم: UPDATE يدوي لفواتير معيّنة.

UPDATE "sales_orders"
   SET "channel" = 'website'
 WHERE "channel" <> 'website'
   AND "notes" LIKE 'تم إنشاؤها تلقائيًا من طلب بوابة العملاء%';

UPDATE "sales_orders" so
   SET "channel" = 'website'
  FROM "system_users" u
 WHERE u."id" = so."created_by_id" AND u."role" = 'online_seller' AND so."channel" <> 'website';

UPDATE "sales_orders" so
   SET "channel" = 'direct'
  FROM "system_users" u
 WHERE u."id" = so."created_by_id" AND u."role" = 'offline_seller' AND so."channel" <> 'direct';

CREATE INDEX IF NOT EXISTS "sales_channel_created_idx" ON "sales_orders" ("channel", "created_at");
