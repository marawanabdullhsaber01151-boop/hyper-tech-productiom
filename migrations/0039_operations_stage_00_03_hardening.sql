-- Stage 00-03 hardening only. This migration does not create plans,
-- reservations, production orders, purchase orders, or stock movements.

ALTER TABLE sales_order_items
  ADD COLUMN IF NOT EXISTS base_unit TEXT NOT NULL DEFAULT 'unit',
  ADD COLUMN IF NOT EXISTS packaging_qty NUMERIC(12, 3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS packaging_unit TEXT NOT NULL DEFAULT 'carton',
  ADD COLUMN IF NOT EXISTS conversion_factor NUMERIC(12, 6) NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_order_items_qty_positive'
  ) THEN
    ALTER TABLE sales_order_items
      ADD CONSTRAINT sales_order_items_qty_positive CHECK (qty > 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_order_items_packaging_qty_non_negative'
  ) THEN
    ALTER TABLE sales_order_items
      ADD CONSTRAINT sales_order_items_packaging_qty_non_negative
      CHECK (packaging_qty >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_order_items_conversion_factor_positive'
  ) THEN
    ALTER TABLE sales_order_items
      ADD CONSTRAINT sales_order_items_conversion_factor_positive
      CHECK (conversion_factor > 0) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS operations_cases_due_date_idx
  ON operations_cases(due_date);

CREATE INDEX IF NOT EXISTS operations_cases_updated_at_idx
  ON operations_cases(updated_at);

CREATE INDEX IF NOT EXISTS operations_cases_sales_order_id_idx
  ON operations_cases(sales_order_id);