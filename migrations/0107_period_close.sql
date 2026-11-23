-- 0107 (الخطوة 55): إقفال الفترة المحاسبية وإعادة فتحها بصلاحية وسبب.
-- القواعد على مستوى القاعدة (خط الدفاع التاني بعد الكود):
--   * الفترة بتتقفل بعد ما الشهر يخلص بس، وبالترتيب (مفيش فترة أقدم لسه مفتوحة).
--   * إعادة الفتح بسبب (3 حروف+) وبالعكس (آخر فترة مقفولة الأول).
--   * سجل الإقفال/الفتح (gl_period_events) للإضافة بس، مفيش تعديل ولا حذف.
--   * الترحيل بيقرا الفترة FOR SHARE، فالإقفال (UPDATE) بيستنى الترحيل الشغّال وبيتحجب بعده.
-- Rollback:
--   DROP TRIGGER IF EXISTS gl_periods_change_guard ON gl_periods; DROP TRIGGER IF EXISTS gl_periods_insert_guard ON gl_periods;
--   DROP TABLE IF EXISTS gl_period_events;
--   ALTER TABLE gl_periods DROP COLUMN IF EXISTS close_note, DROP COLUMN IF EXISTS closed_by, DROP COLUMN IF EXISTS reopened_at, DROP COLUMN IF EXISTS reopened_by_name, DROP COLUMN IF EXISTS reopen_reason, DROP COLUMN IF EXISTS reopen_count;

ALTER TABLE "gl_periods"
  ADD COLUMN IF NOT EXISTS "close_note" text,
  ADD COLUMN IF NOT EXISTS "closed_by" integer REFERENCES "system_users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "reopened_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "reopened_by_name" text,
  ADD COLUMN IF NOT EXISTS "reopen_reason" text,
  ADD COLUMN IF NOT EXISTS "reopen_count" integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "gl_period_events" (
  "id" serial PRIMARY KEY,
  "period_id" integer NOT NULL REFERENCES "gl_periods"("id"),
  "action" text NOT NULL CHECK ("action" IN ('closed','reopened')),
  "reason" text,
  "actor_user_id" integer REFERENCES "system_users"("id") ON DELETE SET NULL,
  "actor_name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CHECK ("action" <> 'reopened' OR char_length(btrim(coalesce("reason", ''))) >= 3)
);
CREATE INDEX IF NOT EXISTS "gl_period_events_period_idx" ON "gl_period_events" ("period_id", "id" DESC);

CREATE OR REPLACE FUNCTION gl_period_events_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'GL_PERIOD_EVENT_IMMUTABLE'; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS gl_period_events_guard ON "gl_period_events";
CREATE TRIGGER gl_period_events_guard BEFORE UPDATE OR DELETE ON "gl_period_events" FOR EACH ROW EXECUTE FUNCTION gl_period_events_immutable();

-- الفترة الجديدة بتتعمل مفتوحة دايمًا
CREATE OR REPLACE FUNCTION gl_guard_period_insert() RETURNS trigger AS $$
BEGIN
  IF NEW.status <> 'open' THEN RAISE EXCEPTION 'GL_PERIOD_MUST_START_OPEN'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS gl_periods_insert_guard ON "gl_periods";
CREATE TRIGGER gl_periods_insert_guard BEFORE INSERT ON "gl_periods" FOR EACH ROW EXECUTE FUNCTION gl_guard_period_insert();

CREATE OR REPLACE FUNCTION gl_guard_period_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'GL_PERIOD_IMMUTABLE'; END IF;
  IF NEW.id <> OLD.id OR NEW.year <> OLD.year OR NEW.month <> OLD.month OR NEW.starts_on <> OLD.starts_on OR NEW.ends_on <> OLD.ends_on THEN
    RAISE EXCEPTION 'GL_PERIOD_IMMUTABLE';
  END IF;
  IF OLD.status = 'open' AND NEW.status = 'closed' THEN
    IF NEW.closed_at IS NULL OR NEW.closed_by_name IS NULL THEN RAISE EXCEPTION 'GL_PERIOD_CLOSE_INCOMPLETE'; END IF;
    IF NEW.ends_on >= (now() AT TIME ZONE 'Africa/Cairo')::date THEN RAISE EXCEPTION 'GL_PERIOD_NOT_ENDED'; END IF;
    IF EXISTS (SELECT 1 FROM gl_periods p WHERE p.ends_on < NEW.starts_on AND p.status = 'open') THEN RAISE EXCEPTION 'GL_PERIOD_EARLIER_OPEN'; END IF;
    RETURN NEW;
  ELSIF OLD.status = 'closed' AND NEW.status = 'open' THEN
    IF NEW.reopen_reason IS NULL OR char_length(btrim(NEW.reopen_reason)) < 3 OR NEW.reopened_at IS NULL OR NEW.reopened_by_name IS NULL THEN
      RAISE EXCEPTION 'GL_PERIOD_REOPEN_REASON';
    END IF;
    IF EXISTS (SELECT 1 FROM gl_periods p WHERE p.starts_on > NEW.ends_on AND p.status = 'closed') THEN RAISE EXCEPTION 'GL_PERIOD_LATER_CLOSED'; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'GL_PERIOD_IMMUTABLE';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS gl_periods_change_guard ON "gl_periods";
CREATE TRIGGER gl_periods_change_guard BEFORE UPDATE OR DELETE ON "gl_periods" FOR EACH ROW EXECUTE FUNCTION gl_guard_period_change();

-- الترحيل بيقفل صف الفترة مشاركةً: الإقفال بيستنى وبعده الترحيل بيشوف «مقفولة»
CREATE OR REPLACE FUNCTION gl_guard_entry_insert() RETURNS trigger AS $$
DECLARE p gl_periods%ROWTYPE;
BEGIN
  SELECT * INTO p FROM gl_periods WHERE id = NEW.period_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GL_PERIOD_MISSING'; END IF;
  IF p.status <> 'open' THEN RAISE EXCEPTION 'GL_PERIOD_CLOSED'; END IF;
  IF NEW.entry_date < p.starts_on OR NEW.entry_date > p.ends_on THEN RAISE EXCEPTION 'GL_DATE_OUTSIDE_PERIOD'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
