-- 0096 — العطلات الرسمية وإجازات المصنع (الخطوة 43ب)
--
-- جدول صغير بتاريخ لكل عطلة وسببها. السعة وتواريخ الانتهاء المتوقعة بتتخطى أيام العطلة زي الإجازة الأسبوعية.
-- مفيش بيانات قديمة تتأثر: الجدول فاضي لحد ما حد يضيف عطلة من الإعدادات.
--
-- Rollback:
--   DROP TABLE IF EXISTS work_holidays;

CREATE TABLE IF NOT EXISTS "work_holidays" (
  "id" serial PRIMARY KEY,
  "holiday_date" date NOT NULL,
  "reason" text NOT NULL,
  "created_by" integer REFERENCES "system_users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "work_holidays_date_unique" ON "work_holidays" ("holiday_date");
