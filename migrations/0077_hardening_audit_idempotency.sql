-- 0077 — تحصين سجل التدقيق + تنظيف سجل الـidempotency
--
-- (1) audit_events: سلسلة الـhash مالهاش قيمة لو أي حد يقدر يعدّل/يحذف الصفوف ويعيد حساب السلسلة
--     (سكربت wipe-customers كان بيعمل كده فعلًا). دلوقتي أي UPDATE/DELETE/TRUNCATE مرفوض، إلا:
--       - الحالة الوحيدة المشروعة: المفتاح الأجنبي actor_user_id (ON DELETE SET NULL) لما موظف يتحذف
--         (التغيير الوحيد المسموح: actor_user_id من قيمة إلى NULL، وكل الأعمدة التانية ثابتة).
--       - صيانة معلنة صراحةً: SET LOCAL hypertech.audit_maintenance = 'on' (داخل transaction)،
--         وده بتستخدمه سكربتات wipe-customers وreset-test-data فقط.
--     ملاحظة معروفة: حذف موظف بيغيّر actor_user_id فبيكسر الـhash لصفوفه — القرار المقترح: إيقاف
--     الموظف (status=inactive) بدل حذفه. موثّق في docs/reports/hardening-1.md.
-- (2) command_idempotency: فهرس على created_at لتنظيف السجلات الأقدم من 48 ساعة (الـcron اليومي).
--
-- Rollback:
--   DROP TRIGGER IF EXISTS audit_events_no_update_delete ON audit_events;
--   DROP TRIGGER IF EXISTS audit_events_no_truncate ON audit_events;
--   DROP FUNCTION IF EXISTS audit_events_block_mutation();
--   DROP INDEX IF EXISTS command_idempotency_created_at_idx;

CREATE INDEX IF NOT EXISTS "command_idempotency_created_at_idx"
  ON "command_idempotency" ("created_at");

CREATE OR REPLACE FUNCTION audit_events_block_mutation() RETURNS trigger AS $fn$
BEGIN
  -- صيانة معلنة صراحةً (داخل transaction): مسموح
  IF current_setting('hypertech.audit_maintenance', true) = 'on' THEN
    IF TG_OP = 'TRUNCATE' THEN
      RETURN NULL;
    ELSIF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  -- المفتاح الأجنبي ON DELETE SET NULL على actor_user_id: التغيير الوحيد المسموح.
  -- IF متداخل (مش AND) لأن PL/pgSQL مابيضمنش short-circuit، وOLD/NEW مش معرّفين في كل نوع عملية.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.actor_user_id IS NOT NULL
       AND NEW.actor_user_id IS NULL
       AND (to_jsonb(NEW) - 'actor_user_id') = (to_jsonb(OLD) - 'actor_user_id') THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'audit_events سجل غير قابل للتعديل (% ممنوع). للصيانة المعتمدة فقط: SET LOCAL hypertech.audit_maintenance = ''on''', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_no_update_delete ON audit_events;
CREATE TRIGGER audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_block_mutation();

DROP TRIGGER IF EXISTS audit_events_no_truncate ON audit_events;
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_block_mutation();
