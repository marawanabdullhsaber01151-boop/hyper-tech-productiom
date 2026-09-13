-- Make historical sales/inventory inconsistencies visible without changing
-- production quantities automatically.
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS stock_sync_status TEXT NOT NULL DEFAULT 'pending_review';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sales_orders_stock_sync_status_check'
  ) THEN
    ALTER TABLE sales_orders
      ADD CONSTRAINT sales_orders_stock_sync_status_check
      CHECK (stock_sync_status IN ('synced', 'pending_review'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS sales_orders_stock_sync_status_idx
  ON sales_orders(stock_sync_status);