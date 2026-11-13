-- 0101 — اكتمال القيد (تصحيح اكتشفه اختبار على PostgreSQL حقيقي بعد 0100)
--
-- الثغرة: ترجر التوازن في 0100 بيشتغل عند إدخال سطر، فقيد من غير أي سطور (أو إجماليه مش مطابق لسطوره)
-- كان بيعدّي. الإصلاح: ترجر مؤجّل على القيد نفسه، بيتفحص وقت الـ COMMIT:
--   سطرين على الأقل، المدين = الدائن، وإجمالي القيد = مجموع المدين.
-- (هجرة جديدة مش تعديل 0100 عشان ما نغيّرش هجرة ممكن تكون اتطبّقت.)
--
-- Rollback:
--   DROP TRIGGER IF EXISTS gl_entries_complete_check ON gl_journal_entries;
--   DROP FUNCTION IF EXISTS gl_check_entry_complete();

CREATE OR REPLACE FUNCTION gl_check_entry_complete() RETURNS trigger AS $$
DECLARE d numeric; c numeric; n integer;
BEGIN
  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0), COUNT(*) INTO d, c, n FROM gl_journal_lines WHERE entry_id = NEW.id;
  IF n < 2 THEN RAISE EXCEPTION 'GL_TOO_FEW_LINES'; END IF;
  IF d <> c THEN RAISE EXCEPTION 'GL_UNBALANCED'; END IF;
  IF NEW.total <> d THEN RAISE EXCEPTION 'GL_TOTAL_MISMATCH'; END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS gl_entries_complete_check ON "gl_journal_entries";
CREATE CONSTRAINT TRIGGER gl_entries_complete_check AFTER INSERT ON "gl_journal_entries" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gl_check_entry_complete();
