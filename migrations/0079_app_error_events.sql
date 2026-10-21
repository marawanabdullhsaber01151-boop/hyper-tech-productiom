-- 0079 — سجل الأخطاء غير المتوقعة (يغذّي صفحة «صحة النظام»)
--
-- كل خطأ 500 كان بيتسجل في لوج السيرفر بس (على Vercel بيضيع بسرعة) فالمدير مكانش يعرف إن حاجة بتفشل.
-- هنا بنحفظ سطر مختصر لكل خطأ: المرجع اللي ظهر للمستخدم + المسار + الرسالة (من غير stack ولا بيانات).
-- الاحتفاظ ٣٠ يوم (التنظيف بيتم عند فتح صفحة الصحة). الجدول بيتكتب فيه بأمان: أي فشل في الكتابة بيتتجاهل.
--
-- Rollback:
--   DROP TABLE IF EXISTS app_error_events;

CREATE TABLE IF NOT EXISTS "app_error_events" (
  "id" bigserial PRIMARY KEY,
  "reference" text NOT NULL,
  "method" text NOT NULL,
  "path" text NOT NULL,
  "message" text NOT NULL,
  "user_id" integer,
  "correlation_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "app_error_events_created_at_idx" ON "app_error_events" ("created_at" DESC);
