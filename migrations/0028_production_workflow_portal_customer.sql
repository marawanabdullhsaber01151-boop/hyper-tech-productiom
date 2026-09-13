-- Hyper-Tech ERP: give portal orders their own customer namespace.
-- created_by_id remains populated for backward compatibility, but portal
-- ownership is now tracked by this dedicated nullable foreign key.

ALTER TABLE production_workflow_orders
  ADD COLUMN IF NOT EXISTS portal_customer_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'production_workflow_orders_portal_customer_id_fk'
      AND conrelid = 'production_workflow_orders'::regclass
  ) THEN
    ALTER TABLE production_workflow_orders
      ADD CONSTRAINT production_workflow_orders_portal_customer_id_fk
      FOREIGN KEY (portal_customer_id) REFERENCES portal_customers(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS production_workflow_orders_portal_customer_idx
  ON production_workflow_orders (portal_customer_id);