-- 0100 — دفتر الأستاذ مزدوج القيد (الخطوة 48)
--
-- دليل حسابات مصري افتراضي (للمراجعة مع محاسب)، فترات شهرية، وقيود يومية بسطور مدين/دائن.
-- الضمانات على مستوى القاعدة نفسها (مش في الكود بس):
--   1) القيد غير المتوازن مرفوض (ترجر مؤجّل بيتفحص وقت الـ COMMIT).
--   2) مفيش ترحيل على فترة مقفولة، وتاريخ القيد لازم يقع جوه فترته.
--   3) القيود والسطور بتتكتب بس: ممنوع التعديل والحذف، والتصحيح بقيد عكسي (القيد الأصلي بس ينتقل من posted لـ reversed).
-- الفترات شهور ميلادي دايمًا؛ السنة المالية تسمية بتتحسب من إعداد شهر البداية، فتغييره مش بيمس القيود.
--
-- Rollback:
--   DROP TABLE IF EXISTS gl_journal_lines, gl_journal_entries, gl_periods, gl_accounts CASCADE;
--   DROP FUNCTION IF EXISTS gl_check_entry_balanced(), gl_guard_entry_insert(), gl_guard_entry_change(), gl_guard_line_change();

CREATE TABLE IF NOT EXISTS "gl_accounts" (
  "id" serial PRIMARY KEY,
  "code" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "type" text NOT NULL CHECK ("type" IN ('asset','liability','equity','revenue','expense')),
  "normal_side" text NOT NULL CHECK ("normal_side" IN ('debit','credit')),
  "parent_id" integer REFERENCES "gl_accounts"("id"),
  "is_postable" boolean NOT NULL DEFAULT true,
  "is_active" boolean NOT NULL DEFAULT true,
  "is_system" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "gl_periods" (
  "id" serial PRIMARY KEY,
  "year" integer NOT NULL,
  "month" integer NOT NULL CHECK ("month" BETWEEN 1 AND 12),
  "starts_on" date NOT NULL,
  "ends_on" date NOT NULL,
  "status" text NOT NULL DEFAULT 'open' CHECK ("status" IN ('open','closed')),
  "closed_at" timestamptz,
  "closed_by_name" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("year", "month")
);

CREATE TABLE IF NOT EXISTS "gl_journal_entries" (
  "id" serial PRIMARY KEY,
  "entry_number" text NOT NULL UNIQUE,
  "entry_date" date NOT NULL,
  "period_id" integer NOT NULL REFERENCES "gl_periods"("id"),
  "description" text NOT NULL,
  "source_type" text NOT NULL DEFAULT 'manual',
  "source_id" text,
  "status" text NOT NULL DEFAULT 'posted' CHECK ("status" IN ('posted','reversed')),
  "reversal_of" integer REFERENCES "gl_journal_entries"("id"),
  "total" numeric(14,2) NOT NULL,
  "created_by" integer REFERENCES "system_users"("id") ON DELETE SET NULL,
  "created_by_name" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "gl_entries_date_idx" ON "gl_journal_entries" ("entry_date", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "gl_entries_source_unique" ON "gl_journal_entries" ("source_type", "source_id") WHERE "source_type" <> 'manual' AND "source_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "gl_entries_reversal_unique" ON "gl_journal_entries" ("reversal_of") WHERE "reversal_of" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "gl_journal_lines" (
  "id" serial PRIMARY KEY,
  "entry_id" integer NOT NULL REFERENCES "gl_journal_entries"("id"),
  "line_no" integer NOT NULL,
  "account_id" integer NOT NULL REFERENCES "gl_accounts"("id"),
  "debit" numeric(14,2) NOT NULL DEFAULT 0 CHECK ("debit" >= 0),
  "credit" numeric(14,2) NOT NULL DEFAULT 0 CHECK ("credit" >= 0),
  "memo" text,
  CHECK (("debit" = 0) <> ("credit" = 0)),
  UNIQUE ("entry_id", "line_no")
);
CREATE INDEX IF NOT EXISTS "gl_lines_account_idx" ON "gl_journal_lines" ("account_id", "entry_id");

-- 2) ترحيل على فترة مفتوحة وتاريخ جوه الفترة
CREATE OR REPLACE FUNCTION gl_guard_entry_insert() RETURNS trigger AS $$
DECLARE p gl_periods%ROWTYPE;
BEGIN
  SELECT * INTO p FROM gl_periods WHERE id = NEW.period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'GL_PERIOD_MISSING'; END IF;
  IF p.status <> 'open' THEN RAISE EXCEPTION 'GL_PERIOD_CLOSED'; END IF;
  IF NEW.entry_date < p.starts_on OR NEW.entry_date > p.ends_on THEN RAISE EXCEPTION 'GL_DATE_OUTSIDE_PERIOD'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS gl_entries_insert_guard ON "gl_journal_entries";
CREATE TRIGGER gl_entries_insert_guard BEFORE INSERT ON "gl_journal_entries" FOR EACH ROW EXECUTE FUNCTION gl_guard_entry_insert();

-- 3) قيود للكتابة بس: التحديث الوحيد المسموح posted -> reversed
CREATE OR REPLACE FUNCTION gl_guard_entry_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'GL_IMMUTABLE'; END IF;
  IF OLD.status = 'posted' AND NEW.status = 'reversed'
     AND NEW.id = OLD.id AND NEW.entry_number = OLD.entry_number AND NEW.entry_date = OLD.entry_date
     AND NEW.period_id = OLD.period_id AND NEW.description = OLD.description AND NEW.total = OLD.total
     AND NEW.source_type = OLD.source_type AND NEW.source_id IS NOT DISTINCT FROM OLD.source_id
     AND NEW.reversal_of IS NOT DISTINCT FROM OLD.reversal_of THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'GL_IMMUTABLE';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS gl_entries_change_guard ON "gl_journal_entries";
CREATE TRIGGER gl_entries_change_guard BEFORE UPDATE OR DELETE ON "gl_journal_entries" FOR EACH ROW EXECUTE FUNCTION gl_guard_entry_change();

CREATE OR REPLACE FUNCTION gl_guard_line_change() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'GL_IMMUTABLE'; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS gl_lines_change_guard ON "gl_journal_lines";
CREATE TRIGGER gl_lines_change_guard BEFORE UPDATE OR DELETE ON "gl_journal_lines" FOR EACH ROW EXECUTE FUNCTION gl_guard_line_change();

-- 1) التوازن: بيتفحص وقت الـ COMMIT بعد ما كل السطور تتكتب
CREATE OR REPLACE FUNCTION gl_check_entry_balanced() RETURNS trigger AS $$
DECLARE d numeric; c numeric; n integer;
BEGIN
  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0), COUNT(*) INTO d, c, n FROM gl_journal_lines WHERE entry_id = NEW.entry_id;
  IF n < 2 THEN RAISE EXCEPTION 'GL_TOO_FEW_LINES'; END IF;
  IF d <> c THEN RAISE EXCEPTION 'GL_UNBALANCED'; END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS gl_lines_balance_check ON "gl_journal_lines";
CREATE CONSTRAINT TRIGGER gl_lines_balance_check AFTER INSERT ON "gl_journal_lines" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gl_check_entry_balanced();

-- دليل الحسابات الافتراضي (للمراجعة مع محاسب؛ تقدر تضيف وتوقف حسابات من الشاشة)
INSERT INTO "gl_accounts" ("code","name","type","normal_side","is_postable","is_system","parent_id")
SELECT v.code, v.name, v.type, v.side, v.postable, true, (SELECT id FROM "gl_accounts" WHERE code = v.parent)
FROM (VALUES
  ('1000','الأصول','asset','debit',false,NULL),
  ('2000','الالتزامات','liability','credit',false,NULL),
  ('3000','حقوق الملكية','equity','credit',false,NULL),
  ('4000','الإيرادات','revenue','credit',false,NULL),
  ('5000','التكاليف والمصروفات','expense','debit',false,NULL)
) AS v(code, name, type, side, postable, parent)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "gl_accounts" ("code","name","type","normal_side","is_postable","is_system","parent_id")
SELECT v.code, v.name, v.type, v.side, v.postable, true, (SELECT id FROM "gl_accounts" WHERE code = v.parent)
FROM (VALUES
  ('1100','الأصول المتداولة','asset','debit',false,'1000'),
  ('1200','الأصول الثابتة','asset','debit',false,'1000'),
  ('2100','الالتزامات المتداولة','liability','credit',false,'2000'),
  ('2200','قروض طويلة الأجل','liability','credit',true,'2000'),
  ('3100','رأس المال','equity','credit',true,'3000'),
  ('3200','الاحتياطيات','equity','credit',true,'3000'),
  ('3300','الأرباح المحتجزة','equity','credit',true,'3000'),
  ('3400','جاري الشركاء','equity','credit',true,'3000'),
  ('4100','إيرادات المبيعات','revenue','credit',true,'4000'),
  ('4110','مردودات ومسموحات المبيعات','revenue','debit',true,'4000'),
  ('4120','خصم مسموح به','revenue','debit',true,'4000'),
  ('4900','إيرادات أخرى','revenue','credit',true,'4000'),
  ('5100','تكلفة المبيعات','expense','debit',false,'5000'),
  ('5200','المصروفات التشغيلية','expense','debit',false,'5000')
) AS v(code, name, type, side, postable, parent)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "gl_accounts" ("code","name","type","normal_side","is_postable","is_system","parent_id")
SELECT v.code, v.name, v.type, v.side, v.postable, true, (SELECT id FROM "gl_accounts" WHERE code = v.parent)
FROM (VALUES
  ('1110','النقدية بالخزينة','asset','debit',true,'1100'),
  ('1120','البنوك','asset','debit',true,'1100'),
  ('1130','العملاء','asset','debit',true,'1100'),
  ('1140','أوراق القبض','asset','debit',true,'1100'),
  ('1150','مخزون الخامات','asset','debit',true,'1100'),
  ('1160','مخزون تحت التشغيل','asset','debit',true,'1100'),
  ('1170','مخزون الإنتاج التام','asset','debit',true,'1100'),
  ('1180','دفعات مقدمة للموردين','asset','debit',true,'1100'),
  ('1190','ضريبة القيمة المضافة - مدخلات','asset','debit',true,'1100'),
  ('1210','الآلات والمعدات','asset','debit',true,'1200'),
  ('1220','الأراضي والمباني','asset','debit',true,'1200'),
  ('1230','وسائل النقل','asset','debit',true,'1200'),
  ('1240','الأثاث والمعدات المكتبية','asset','debit',true,'1200'),
  ('1290','مجمع الإهلاك','asset','credit',true,'1200'),
  ('2110','الموردون','liability','credit',true,'2100'),
  ('2120','أوراق الدفع','liability','credit',true,'2100'),
  ('2130','ضريبة القيمة المضافة - مخرجات','liability','credit',true,'2100'),
  ('2140','ضرائب ورسوم مستحقة','liability','credit',true,'2100'),
  ('2150','رواتب وأجور مستحقة','liability','credit',true,'2100'),
  ('2160','دفعات مقدمة من العملاء','liability','credit',true,'2100'),
  ('2170','مصروفات مستحقة','liability','credit',true,'2100'),
  ('5110','تكلفة الخامات المستهلكة','expense','debit',true,'5100'),
  ('5120','الأجور المباشرة','expense','debit',true,'5100'),
  ('5130','مصروفات التصنيع غير المباشرة','expense','debit',true,'5100'),
  ('5140','انحرافات التكلفة','expense','debit',true,'5100'),
  ('5210','الرواتب والأجور الإدارية','expense','debit',true,'5200'),
  ('5220','الإيجارات','expense','debit',true,'5200'),
  ('5230','الكهرباء والمياه والغاز','expense','debit',true,'5200'),
  ('5240','مصروفات البيع والتسويق','expense','debit',true,'5200'),
  ('5250','المصروفات البنكية','expense','debit',true,'5200'),
  ('5260','الإهلاك','expense','debit',true,'5200'),
  ('5290','مصروفات أخرى','expense','debit',true,'5200')
) AS v(code, name, type, side, postable, parent)
ON CONFLICT ("code") DO NOTHING;
