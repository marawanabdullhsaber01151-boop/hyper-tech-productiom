-- 0081 — أوامر الشراء (المشتريات v1)
--
-- وحدة المشتريات القديمة اتشالت في المرحلة 2 ومحدش رجّعها، فطلبات الشراء (من الإنتاج والتخطيط) كانت بتقف
-- من غير مكان تتحول فيه لأمر لمورّد ولا استلام بيدخل المخزون. ده الجدولين الأساسيين:
--   purchase_orders        رأس الأمر (مورّد، حالة، تواريخ، إجمالي محسوب في السيرفر)
--   purchase_order_items   البنود (صنف مخزون، كمية، سعر، والمستلم لحد دلوقتي، ومصدر الاحتياج لو فيه)
-- الحالات: draft → pending_approval → approved → sent → partially_received → received، أو cancelled.
-- كل الأرقام بتتحسب في السيرفر (الإجمالي من البنود، والمستلم من الاستلامات الفعلية).
-- ما بيلمسش أي بيانات موجودة.
--
-- Rollback:
--   DROP TABLE IF EXISTS purchase_order_items;
--   DROP TABLE IF EXISTS purchase_orders;
--   DELETE FROM phase0_number_sequences WHERE sequence_key = 'purchase_order';

INSERT INTO "phase0_number_sequences" ("sequence_key", "prefix", "next_value", "padding")
VALUES ('purchase_order', 'PO-', 1, 6)
ON CONFLICT ("sequence_key") DO NOTHING;

CREATE TABLE IF NOT EXISTS "purchase_orders" (
  "id" serial PRIMARY KEY NOT NULL,
  "po_number" text NOT NULL UNIQUE,
  "supplier_id" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "expected_date" date,
  "notes" text,
  "total" numeric(14,2) NOT NULL DEFAULT '0',
  "created_by" integer NOT NULL,
  "created_by_name" text,
  "approved_by" integer,
  "approved_at" timestamptz,
  "sent_at" timestamptz,
  "cancel_reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "purchase_orders_status_idx" ON "purchase_orders" ("status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "purchase_orders_supplier_idx" ON "purchase_orders" ("supplier_id");

CREATE TABLE IF NOT EXISTS "purchase_order_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "po_id" integer NOT NULL REFERENCES "purchase_orders"("id") ON DELETE CASCADE,
  "inventory_item_id" integer NOT NULL,
  "description" text NOT NULL,
  "unit" text,
  "qty" numeric(14,3) NOT NULL,
  "unit_price" numeric(12,2) NOT NULL DEFAULT '0',
  "received_qty" numeric(14,3) NOT NULL DEFAULT '0',
  "requisition_source" text,
  "requisition_id" integer
);

CREATE INDEX IF NOT EXISTS "purchase_order_items_po_idx" ON "purchase_order_items" ("po_id");
CREATE INDEX IF NOT EXISTS "purchase_order_items_item_idx" ON "purchase_order_items" ("inventory_item_id");
