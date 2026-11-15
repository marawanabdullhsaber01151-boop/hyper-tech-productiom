-- 0103 — تحصيلات العملاء وتخصيصها على الفواتير (الخطوة 50)
--
-- customer_payments: التحصيل نفسه (نقدي/بنكي). الإلغاء بيغيّر الحالة بس (مفيش حذف)، والقيد المحاسبي بيتعكس.
-- payment_allocations: توزيع التحصيل على أوامر البيع. مجموع التخصيص ما يزيدش عن مبلغ التحصيل (ترجر على القاعدة كخط دفاع تاني).
-- المتبقي بدون تخصيص = رصيد دائن للعميل (دفعة مقدمة) لحد ما يتوزّع.
--
-- Rollback:
--   DROP TABLE IF EXISTS payment_allocations, customer_payments CASCADE;
--   DROP FUNCTION IF EXISTS pay_check_allocation_sum();
--   INSERT INTO phase0_number_sequences ... (الترقيم بيتمسح بإزالة الصف 'customer_payment')

CREATE TABLE IF NOT EXISTS "customer_payments" (
  "id" serial PRIMARY KEY,
  "payment_number" text NOT NULL UNIQUE,
  "contact_id" integer NOT NULL REFERENCES "contacts"("id"),
  "payment_date" date NOT NULL,
  "method" text NOT NULL CHECK ("method" IN ('cash','bank')),
  "amount" numeric(14,2) NOT NULL CHECK ("amount" > 0),
  "reference" text,
  "notes" text,
  "status" text NOT NULL DEFAULT 'posted' CHECK ("status" IN ('posted','voided')),
  "journal_entry_id" integer REFERENCES "gl_journal_entries"("id"),
  "void_reason" text,
  "voided_at" timestamptz,
  "voided_by_name" text,
  "created_by" integer,
  "created_by_name" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "customer_payments_contact_idx" ON "customer_payments" ("contact_id", "payment_date");

CREATE TABLE IF NOT EXISTS "payment_allocations" (
  "id" serial PRIMARY KEY,
  "payment_id" integer NOT NULL REFERENCES "customer_payments"("id"),
  "sales_order_id" integer NOT NULL REFERENCES "sales_orders"("id"),
  "amount" numeric(14,2) NOT NULL CHECK ("amount" > 0),
  "created_by_name" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "payment_allocations_payment_idx" ON "payment_allocations" ("payment_id");
CREATE INDEX IF NOT EXISTS "payment_allocations_order_idx" ON "payment_allocations" ("sales_order_id");

CREATE OR REPLACE FUNCTION pay_check_allocation_sum() RETURNS trigger AS $$
DECLARE total numeric; paid numeric;
BEGIN
  SELECT amount INTO total FROM customer_payments WHERE id = NEW.payment_id FOR UPDATE;
  SELECT COALESCE(SUM(amount), 0) INTO paid FROM payment_allocations WHERE payment_id = NEW.payment_id;
  IF paid > total THEN RAISE EXCEPTION 'PAY_ALLOCATION_EXCEEDS'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS payment_allocations_sum_check ON "payment_allocations";
CREATE TRIGGER payment_allocations_sum_check AFTER INSERT ON "payment_allocations" FOR EACH ROW EXECUTE FUNCTION pay_check_allocation_sum();

-- التخصيصات بتتكتب بس (مفيش تعديل ولا حذف)، عشان أثر التحصيل يفضل واضح بعد الإلغاء.
CREATE OR REPLACE FUNCTION pay_allocations_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'PAY_ALLOCATION_IMMUTABLE'; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS payment_allocations_no_change ON "payment_allocations";
CREATE TRIGGER payment_allocations_no_change BEFORE UPDATE OR DELETE ON "payment_allocations" FOR EACH ROW EXECUTE FUNCTION pay_allocations_immutable();

INSERT INTO "phase0_number_sequences" ("sequence_key","prefix","padding","next_value","active")
SELECT 'customer_payment','RC-',5,1,true
WHERE NOT EXISTS (SELECT 1 FROM "phase0_number_sequences" WHERE "sequence_key" = 'customer_payment');
