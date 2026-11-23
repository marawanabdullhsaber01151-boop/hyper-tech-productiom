-- 0105 — إبلاغ العميل عن تحويل (الخطوة 53أ)
--
-- العميل من البوابة يبلّغ إنه حوّل فلوس. التقرير بيفضل «معلّق» لحد ما المالية تتأكد من الحساب:
--   تأكيد  ← بيتسجّل تحصيل رسمي (customer_payments) وبيتربط بالتقرير.
--   رفض    ← بسبب إجباري، والعميل بيتبلّغ.
-- التقرير مش تحصيل: ملوش أثر على الأرصدة ولا الدفتر قبل التأكيد.
--
-- الضمانات على القاعدة (خط دفاع تاني):
--   - مبلغ موجب، وحالة من 3 قيم بس.
--   - مؤكَّد لازم له تحصيل ومبلغ مؤكَّد؛ مرفوض لازم له سبب.
--   - نفس رقم العملية لنفس العميل مينفعش يتبلّغ مرتين (طالما معلّق أو مؤكَّد).
--   - التقرير بعد ما يتأكد أو يترفض مبيتعدّلش (ترجر).
--
-- Rollback:
--   DROP TRIGGER IF EXISTS transfer_reports_final_guard ON "customer_transfer_reports";
--   DROP FUNCTION IF EXISTS transfer_reports_final_guard();
--   DROP TABLE IF EXISTS "customer_transfer_reports";
--   DELETE FROM "phase0_number_sequences" WHERE "sequence_key" = 'transfer_report';
--   UPDATE portal_roles SET permissions = array_remove(permissions, 'payments.report') WHERE company_id IS NULL;

CREATE TABLE IF NOT EXISTS "customer_transfer_reports" (
  "id" serial PRIMARY KEY,
  "report_number" text NOT NULL UNIQUE,
  "contact_id" integer NOT NULL REFERENCES "contacts"("id"),
  "portal_customer_id" integer NOT NULL REFERENCES "portal_customers"("id"),
  "reported_by_member_id" integer,
  "reported_by_name" text NOT NULL,
  "amount" numeric(14,2) NOT NULL CHECK ("amount" > 0),
  "transfer_date" date NOT NULL,
  "method" text NOT NULL CHECK ("method" IN ('bank','instapay','wallet')),
  "reference" text NOT NULL,
  "note" text,
  "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','confirmed','rejected')),
  "task_id" integer,
  "payment_id" integer REFERENCES "customer_payments"("id"),
  "confirmed_amount" numeric(14,2) CHECK ("confirmed_amount" IS NULL OR "confirmed_amount" > 0),
  "review_note" text,
  "reject_reason" text,
  "reviewed_by" integer,
  "reviewed_by_name" text,
  "reviewed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "transfer_reports_confirmed_shape" CHECK ("status" <> 'confirmed' OR ("payment_id" IS NOT NULL AND "confirmed_amount" IS NOT NULL AND "reviewed_at" IS NOT NULL)),
  CONSTRAINT "transfer_reports_rejected_shape" CHECK ("status" <> 'rejected' OR (length(btrim(coalesce("reject_reason", ''))) >= 3 AND "reviewed_at" IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS "transfer_reports_company_idx" ON "customer_transfer_reports" ("portal_customer_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "transfer_reports_status_idx" ON "customer_transfer_reports" ("status", "created_at" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "transfer_reports_reference_unique"
  ON "customer_transfer_reports" ("contact_id", lower(btrim("reference")))
  WHERE "status" IN ('pending','confirmed');

CREATE OR REPLACE FUNCTION transfer_reports_final_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'pending' THEN RAISE EXCEPTION 'TRANSFER_REPORT_FINAL'; END IF;
  IF NEW.contact_id <> OLD.contact_id OR NEW.portal_customer_id <> OLD.portal_customer_id OR NEW.amount <> OLD.amount
     OR NEW.transfer_date <> OLD.transfer_date OR NEW.reference <> OLD.reference OR NEW.method <> OLD.method THEN
    RAISE EXCEPTION 'TRANSFER_REPORT_FIELDS_LOCKED';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS transfer_reports_final_guard ON "customer_transfer_reports";
CREATE TRIGGER transfer_reports_final_guard BEFORE UPDATE ON "customer_transfer_reports" FOR EACH ROW EXECUTE FUNCTION transfer_reports_final_guard();

INSERT INTO "phase0_number_sequences" ("sequence_key","prefix","padding","next_value","active")
SELECT 'transfer_report','TR-',5,1,true
WHERE NOT EXISTS (SELECT 1 FROM "phase0_number_sequences" WHERE "sequence_key" = 'transfer_report');

-- صلاحية «يبلّغ عن تحويل» لقوالب الأدوار (رئيس الشركة والمدير). أدوار الشركات الحالية بتفضل زي ما هي: صاحب الشركة بيدّيها من شاشة الفريق.
UPDATE "portal_roles" SET "permissions" = array_append("permissions", 'payments.report')
WHERE "company_id" IS NULL AND "key" IN ('owner','manager') AND NOT ('payments.report' = ANY("permissions"));
