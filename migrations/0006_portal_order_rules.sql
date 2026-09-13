ALTER TABLE portal_customers
  ADD COLUMN IF NOT EXISTS minimum_order_quantity integer NOT NULL DEFAULT 1;

ALTER TABLE portal_order_reviews
  ADD COLUMN IF NOT EXISTS expected_delivery date;

ALTER TABLE production_workflow_orders
  ALTER COLUMN needed_by DROP NOT NULL;