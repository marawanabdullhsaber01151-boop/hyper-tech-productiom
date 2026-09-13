-- Hyper-Tech ERP: schema completion for production delivery, supplier planning,
-- and customer portal accounts. Safe to run more than once.
ALTER TABLE production_workflow_orders
  ADD COLUMN IF NOT EXISTS pending_delivery_inventory_item_id integer,
  ADD COLUMN IF NOT EXISTS pending_delivery_add_to_inventory boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_initiated_by_id integer,
  ADD COLUMN IF NOT EXISTS delivery_initiated_by_name text,
  ADD COLUMN IF NOT EXISTS delivery_initiated_at timestamptz;
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS supplier_id integer,
  ADD COLUMN IF NOT EXISTS lead_days integer;
CREATE INDEX IF NOT EXISTS inventory_supplier_idx ON inventory_items (supplier_id);
CREATE TABLE IF NOT EXISTS portal_customers (
  id serial PRIMARY KEY,
  phone text NOT NULL,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  company_name text,
  contact_id integer NOT NULL REFERENCES contacts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS portal_customers_phone_unique ON portal_customers (phone);
