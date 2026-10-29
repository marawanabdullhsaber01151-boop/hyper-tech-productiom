-- 0085 — صندوق الصادر المضمون (outbox) — الخطوة 29
--
-- أي أثر جانبي لازم يوصل (إشعار داخلي، تنبيه أمان للعميل، وبعدين رسائل الطلبات والسلامة) بيتكتب هنا في نفس
-- المعاملة (أو كاحتياطي لو الإرسال المباشر فشل)، وعامل بيعيد المحاولة بتراجع زمني (دقيقة، 5، 30، ساعتين، 12 ساعة)
-- لحد 6 محاولات ثم status = dead وتظهر في «صحة النظام».
-- dedupe_key فريد (لو مش فاضي): نفس المفتاح مرتين = سطر واحد، فمفيش رسالة بتتكرر.
-- ما بيلمسش أي بيانات موجودة.
--
-- Rollback:
--   DROP TABLE IF EXISTS outbox_events;

CREATE TABLE IF NOT EXISTS "outbox_events" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "dedupe_key" text,
  "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'done', 'dead')),
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 6,
  "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
  "last_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "processed_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "outbox_events_dedupe_unique" ON "outbox_events" ("dedupe_key") WHERE "dedupe_key" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "outbox_events_due_idx" ON "outbox_events" ("next_attempt_at", "id") WHERE "status" = 'pending';
CREATE INDEX IF NOT EXISTS "outbox_events_status_idx" ON "outbox_events" ("status", "created_at");
