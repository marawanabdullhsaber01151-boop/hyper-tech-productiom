-- 0092 — تفعيل pg_trgm (تشابه الأسماء) — الخطوة 38ب
--
-- بيستخدمه كشف تكرار جهات الاتصال (/contacts/duplicate-check) للمقارنة بالتشابه بدل المطابقة الحرفية فقط.
-- امتداد بس: ما بيضيفش جداول ولا بيلمس بيانات. على Neon بيشتغل من مالك قاعدة البيانات.
--
-- Rollback:
--   DROP EXTENSION IF EXISTS pg_trgm;

CREATE EXTENSION IF NOT EXISTS pg_trgm;
