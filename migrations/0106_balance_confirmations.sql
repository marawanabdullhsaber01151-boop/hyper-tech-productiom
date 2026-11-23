-- 0106 — تأكيد الأرصدة (الخطوة 53ب)
--
-- المالية بتطلب من العميل يؤكد رصيده في يوم معيّن. الطلب بيحفظ «لقطة» من كشف الحساب (الرصيد والحركات) عشان اللي العميل بيوافق عليه ميتغيّرش بعدين.
--   العميل: يوافق (agreed) أو يعترض (disputed) بسبب، وممكن يكتب رقمه.
--   الاعتراض بيفتح مهمة للمالية بموعد. المالية بتقفله بملاحظة (resolved).
--   المالية ممكن تلغي الطلب بسبب (cancelled).
-- التأكيد مش قيد محاسبي: ملوش أثر على الدفتر ولا الأرصدة، هو إقرار موثّق بس.
--
-- الضمانات على القاعدة:
--   - طلب واحد مفتوح (open أو disputed) لكل عميل.
--   - انتقالات الحالة محددة (open ← agreed/disputed/cancelled، disputed ← resolved/cancelled) وغير كده الترجر بيرفض.
--   - اللقطة (الرصيد، التاريخ، الحركات، المهلة) مقفولة ومبتتعدّلش أبدًا.
--   - كل حالة لها بياناتها: الاعتراض بسبب، والحل بملاحظة، والإلغاء بسبب.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS balance_confirmations_guard ON "balance_confirmations";
--   DROP FUNCTION IF EXISTS balance_confirmations_guard();
--   DROP TABLE IF EXISTS "balance_confirmations";
--   DELETE FROM "phase0_number_sequences" WHERE "sequence_key" = 'balance_confirmation';
--   UPDATE portal_roles SET permissions = array_remove(permissions, 'payments.confirm_balance') WHERE company_id IS NULL;

CREATE TABLE IF NOT EXISTS "balance_confirmations" (
  "id" serial PRIMARY KEY,
  "confirmation_number" text NOT NULL UNIQUE,
  "contact_id" integer NOT NULL REFERENCES "contacts"("id"),
  "portal_customer_id" integer NOT NULL REFERENCES "portal_customers"("id"),
  "as_of" date NOT NULL,
  "balance" numeric(14,2) NOT NULL,
  "period_from" date NOT NULL,
  "opening" numeric(14,2) NOT NULL,
  "lines" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "note" text,
  "due_date" date NOT NULL,
  "requested_by" integer,
  "requested_by_name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'open' CHECK ("status" IN ('open','agreed','disputed','resolved','cancelled')),
  "responded_by_member_id" integer,
  "responded_by_name" text,
  "responded_at" timestamptz,
  "customer_amount" numeric(14,2),
  "customer_note" text,
  "task_id" integer,
  "resolution_note" text,
  "resolved_by" integer,
  "resolved_by_name" text,
  "resolved_at" timestamptz,
  "cancel_reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "balance_conf_agreed_shape" CHECK ("status" <> 'agreed' OR "responded_at" IS NOT NULL),
  CONSTRAINT "balance_conf_disputed_shape" CHECK ("status" NOT IN ('disputed','resolved') OR (length(btrim(coalesce("customer_note", ''))) >= 3 AND "responded_at" IS NOT NULL)),
  CONSTRAINT "balance_conf_resolved_shape" CHECK ("status" <> 'resolved' OR (length(btrim(coalesce("resolution_note", ''))) >= 3 AND "resolved_at" IS NOT NULL)),
  CONSTRAINT "balance_conf_cancelled_shape" CHECK ("status" <> 'cancelled' OR length(btrim(coalesce("cancel_reason", ''))) >= 3)
);
CREATE INDEX IF NOT EXISTS "balance_conf_company_idx" ON "balance_confirmations" ("portal_customer_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "balance_conf_status_idx" ON "balance_confirmations" ("status", "due_date");
CREATE UNIQUE INDEX IF NOT EXISTS "balance_conf_one_active" ON "balance_confirmations" ("contact_id") WHERE "status" IN ('open','disputed');

CREATE OR REPLACE FUNCTION balance_confirmations_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.contact_id <> OLD.contact_id OR NEW.portal_customer_id <> OLD.portal_customer_id OR NEW.as_of <> OLD.as_of
     OR NEW.balance <> OLD.balance OR NEW.period_from <> OLD.period_from OR NEW.opening <> OLD.opening
     OR NEW.lines IS DISTINCT FROM OLD.lines OR NEW.due_date <> OLD.due_date THEN
    RAISE EXCEPTION 'BALANCE_SNAPSHOT_LOCKED';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'open' AND NEW.status IN ('agreed','disputed','cancelled'))
    OR (OLD.status = 'disputed' AND NEW.status IN ('resolved','cancelled'))) THEN
    RAISE EXCEPTION 'BALANCE_BAD_TRANSITION';
  END IF;
  IF NEW.status = OLD.status AND OLD.status IN ('agreed','resolved','cancelled') THEN
    RAISE EXCEPTION 'BALANCE_BAD_TRANSITION';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS balance_confirmations_guard ON "balance_confirmations";
CREATE TRIGGER balance_confirmations_guard BEFORE UPDATE ON "balance_confirmations" FOR EACH ROW EXECUTE FUNCTION balance_confirmations_guard();

INSERT INTO "phase0_number_sequences" ("sequence_key","prefix","padding","next_value","active")
SELECT 'balance_confirmation','BC-',5,1,true
WHERE NOT EXISTS (SELECT 1 FROM "phase0_number_sequences" WHERE "sequence_key" = 'balance_confirmation');

-- صلاحية «يؤكد رصيد الشركة»: إقرار مالي، فبتتدّي لقالب رئيس الشركة بس. صاحب الشركة بيدّيها لغيره بإرادته.
UPDATE "portal_roles" SET "permissions" = array_append("permissions", 'payments.confirm_balance')
WHERE "company_id" IS NULL AND "key" = 'owner' AND NOT ('payments.confirm_balance' = ANY("permissions"));
