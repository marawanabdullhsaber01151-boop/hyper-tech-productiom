-- 0089 — فحص استلام الخامات قبل دخول المخزن — الخطوة 36
--
-- قبل كده استلام أمر الشراء كان بيدخّل المخزون على طول. دلوقتي الاستلام بيسجّل إيصال «مستني فحص» من غير ما يلمس
-- المخزون، ومراقب جودة الخامات يقبل أو يرفض كل بند (الرفض بسبب إجباري)، والكمية المقبولة بس هي اللي بتدخل المخزون
-- بحركة وارد مرتبطة بالأمر، والمرفوضة بترجع متبقية على الأمر (للتعويض من المورّد).
--   purchase_receipts       رأس الإيصال (رقم GRN-، الأمر، الحالة، مين استلم ومين فحص)
--   purchase_receipt_lines  بنود الإيصال (البند، المستلم، المقبول، المرفوض وسببه)
-- الحالات: pending_inspection ← accepted | partially_accepted | rejected.
-- ما بيلمسش أي بيانات موجودة (الاستلامات القديمة دخلت المخزون فعلًا ومش هتتأثر).
--
-- Rollback:
--   DROP TABLE IF EXISTS purchase_receipt_lines;
--   DROP TABLE IF EXISTS purchase_receipts;
--   DELETE FROM phase0_number_sequences WHERE sequence_key = 'purchase_receipt';

INSERT INTO "phase0_number_sequences" ("sequence_key", "prefix", "next_value", "padding")
VALUES ('purchase_receipt', 'GRN-', 1, 6)
ON CONFLICT ("sequence_key") DO NOTHING;

CREATE TABLE IF NOT EXISTS "purchase_receipts" (
  "id" serial PRIMARY KEY NOT NULL,
  "receipt_number" text NOT NULL UNIQUE,
  "po_id" integer NOT NULL REFERENCES "purchase_orders"("id"),
  "status" text NOT NULL DEFAULT 'pending_inspection'
    CHECK ("status" IN ('pending_inspection', 'accepted', 'partially_accepted', 'rejected')),
  "notes" text,
  "received_by" integer NOT NULL,
  "received_by_name" text,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "inspected_by" integer,
  "inspected_by_name" text,
  "inspected_at" timestamptz,
  "inspection_notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "purchase_receipts_status_idx" ON "purchase_receipts" ("status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "purchase_receipts_po_idx" ON "purchase_receipts" ("po_id");

CREATE TABLE IF NOT EXISTS "purchase_receipt_lines" (
  "id" serial PRIMARY KEY NOT NULL,
  "receipt_id" integer NOT NULL REFERENCES "purchase_receipts"("id") ON DELETE CASCADE,
  "po_item_id" integer NOT NULL REFERENCES "purchase_order_items"("id"),
  "inventory_item_id" integer NOT NULL,
  "description" text NOT NULL,
  "unit" text,
  "qty_received" numeric(14,3) NOT NULL CHECK ("qty_received" > 0),
  "qty_accepted" numeric(14,3) CHECK ("qty_accepted" >= 0),
  "qty_rejected" numeric(14,3) CHECK ("qty_rejected" >= 0),
  "reject_reason" text
);

CREATE INDEX IF NOT EXISTS "purchase_receipt_lines_receipt_idx" ON "purchase_receipt_lines" ("receipt_id");
CREATE INDEX IF NOT EXISTS "purchase_receipt_lines_po_item_idx" ON "purchase_receipt_lines" ("po_item_id");
