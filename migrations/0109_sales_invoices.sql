-- 0109 (الخطوة 56): الفاتورة الإلكترونية الداخلية. من غير أي اتصال بمصلحة الضرائب.
--   * ترقيم بلا فجوات: الرقم بيتاخد من phase0_number_sequences (قفل الصف) جوه نفس معاملة الإصدار، فلو الإصدار فشل الرقم بيرجع.
--   * كل أمر بيع ليه فاتورة واحدة بالكتير، وسطر الفاتورة لقطة (snapshot) من الأمر وقت الإصدار.
--   * الفاتورة الصادرة ثابتة: مفيش تعديل ولا حذف (التصحيح بإشعار دائن في الخطوة 57).
--   * الختم: HMAC-SHA256 بمفتاح INVOICE_SEAL_KEY (في الكود مش في القاعدة). القاعدة بتحفظ الختم وبصمة المفتاح بس.
--   * أمر البيع اللي ليه فاتورة بيتقفل ضد تغيير الإجمالي/العميل/التاريخ/الأصناف أو الإلغاء أو الحذف.
-- Rollback:
--   DROP TRIGGER IF EXISTS sales_orders_invoice_lock ON sales_orders; DROP TRIGGER IF EXISTS sales_order_items_invoice_lock ON sales_order_items;
--   DROP FUNCTION IF EXISTS inv_guard_order(); DROP FUNCTION IF EXISTS inv_guard_items(); DROP FUNCTION IF EXISTS inv_immutable();
--   DROP TABLE IF EXISTS sales_invoices; DELETE FROM phase0_number_sequences WHERE sequence_key = 'sales_invoice';

CREATE TABLE IF NOT EXISTS "sales_invoices" (
  "id" serial PRIMARY KEY,
  "invoice_number" text NOT NULL UNIQUE,
  "order_id" integer NOT NULL UNIQUE REFERENCES "sales_orders"("id"),
  "order_number" text NOT NULL,
  "contact_id" integer REFERENCES "contacts"("id"),
  "customer_name" text NOT NULL,
  "issue_date" date NOT NULL,
  "subtotal" numeric(14,2) NOT NULL CHECK ("subtotal" >= 0),
  "tax_rate" numeric(5,2) NOT NULL DEFAULT 0 CHECK ("tax_rate" >= 0 AND "tax_rate" <= 100),
  "tax_amount" numeric(14,2) NOT NULL DEFAULT 0 CHECK ("tax_amount" >= 0),
  "total" numeric(14,2) NOT NULL CHECK ("total" >= 0),
  "lines" jsonb NOT NULL,
  "seal" text NOT NULL CHECK ("seal" ~ '^[0-9a-f]{64}$'),
  "seal_key_id" text NOT NULL,
  "seal_version" integer NOT NULL DEFAULT 1,
  "issued_by" integer REFERENCES "system_users"("id") ON DELETE SET NULL,
  "issued_by_name" text NOT NULL,
  "issued_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "sales_invoices_contact_idx" ON "sales_invoices" ("contact_id", "issue_date");
CREATE INDEX IF NOT EXISTS "sales_invoices_date_idx" ON "sales_invoices" ("issue_date", "id");

INSERT INTO "phase0_number_sequences" ("sequence_key", "prefix", "next_value", "padding")
VALUES ('sales_invoice', 'INV-', 1, 6)
ON CONFLICT ("sequence_key") DO NOTHING;

CREATE OR REPLACE FUNCTION inv_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'INV_IMMUTABLE'; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS sales_invoices_guard ON "sales_invoices";
CREATE TRIGGER sales_invoices_guard BEFORE UPDATE OR DELETE ON "sales_invoices" FOR EACH ROW EXECUTE FUNCTION inv_immutable();

CREATE OR REPLACE FUNCTION inv_guard_order() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sales_invoices WHERE order_id = OLD.id) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'INV_ORDER_LOCKED'; END IF;
  IF NEW.total IS DISTINCT FROM OLD.total OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
     OR NEW.contact_id IS DISTINCT FROM OLD.contact_id OR NEW.date IS DISTINCT FROM OLD.date
     OR (NEW.status = 'cancelled' AND OLD.status <> 'cancelled') OR NEW.status = 'draft' OR NEW.status = 'pending_approval' THEN
    RAISE EXCEPTION 'INV_ORDER_LOCKED';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS sales_orders_invoice_lock ON "sales_orders";
CREATE TRIGGER sales_orders_invoice_lock BEFORE UPDATE OR DELETE ON "sales_orders" FOR EACH ROW EXECUTE FUNCTION inv_guard_order();

CREATE OR REPLACE FUNCTION inv_guard_items() RETURNS trigger AS $$
DECLARE oid integer;
BEGIN
  oid := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  IF EXISTS (SELECT 1 FROM sales_invoices WHERE order_id = oid) THEN RAISE EXCEPTION 'INV_ORDER_LOCKED'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS sales_order_items_invoice_lock ON "sales_order_items";
CREATE TRIGGER sales_order_items_invoice_lock BEFORE INSERT OR UPDATE OR DELETE ON "sales_order_items" FOR EACH ROW EXECUTE FUNCTION inv_guard_items();
