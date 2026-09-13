CREATE TABLE IF NOT EXISTS fulfillment_allocations (
  id serial PRIMARY KEY,
  sales_order_id integer NOT NULL REFERENCES sales_orders(id),
  sales_order_item_id integer NOT NULL REFERENCES sales_order_items(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_id integer,
  inventory_item_id integer,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'planned',
  created_by integer NOT NULL REFERENCES system_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fulfillment_allocations_item_source_unique UNIQUE (sales_order_item_id, source_type, source_id)
);
CREATE INDEX IF NOT EXISTS fulfillment_allocations_order_idx ON fulfillment_allocations(sales_order_id);

CREATE TABLE IF NOT EXISTS purchase_requisitions (
  id serial PRIMARY KEY,
  sales_order_id integer REFERENCES sales_orders(id),
  workflow_order_id integer REFERENCES production_workflow_orders(id),
  inventory_item_id integer,
  material_name text NOT NULL,
  required_qty numeric(14,3) NOT NULL CHECK (required_qty > 0),
  available_qty numeric(14,3) NOT NULL DEFAULT 0,
  shortage_qty numeric(14,3) NOT NULL CHECK (shortage_qty > 0),
  status text NOT NULL DEFAULT 'pending_operations',
  reason text NOT NULL,
  confirmed_by integer REFERENCES system_users(id),
  confirmed_at timestamptz,
  created_by integer NOT NULL REFERENCES system_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_requisitions_workflow_item_unique UNIQUE (workflow_order_id, inventory_item_id, material_name)
);
CREATE INDEX IF NOT EXISTS purchase_requisitions_workflow_idx ON purchase_requisitions(workflow_order_id, status);

CREATE TABLE IF NOT EXISTS operation_transfers (
  id serial PRIMARY KEY,
  workflow_order_id integer NOT NULL REFERENCES production_workflow_orders(id),
  direction text NOT NULL,
  inventory_item_id integer,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'pending',
  idempotency_key text NOT NULL UNIQUE,
  prepared_by integer NOT NULL REFERENCES system_users(id),
  received_by integer REFERENCES system_users(id),
  prepared_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz,
  notes text
);
CREATE INDEX IF NOT EXISTS operation_transfers_workflow_idx ON operation_transfers(workflow_order_id, status);

CREATE TABLE IF NOT EXISTS workflow_events (
  id serial PRIMARY KEY,
  workflow_order_id integer NOT NULL REFERENCES production_workflow_orders(id),
  internal_status text NOT NULL,
  customer_status text,
  actor_user_id integer REFERENCES system_users(id),
  actor_name text,
  automatic boolean NOT NULL DEFAULT false,
  cause text,
  details text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workflow_events_workflow_idx ON workflow_events(workflow_order_id, created_at);

ALTER TABLE production_workflow_orders
  ADD COLUMN IF NOT EXISTS parent_workflow_order_id integer REFERENCES production_workflow_orders(id),
  ADD COLUMN IF NOT EXISTS root_sales_order_id integer REFERENCES sales_orders(id),
  ADD COLUMN IF NOT EXISTS source_type text;

CREATE OR REPLACE FUNCTION record_workflow_customer_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  public_status text;
BEGIN
  public_status := CASE NEW.workflow_status
    WHEN 'new' THEN 'received'
    WHEN 'pending_supervisor' THEN 'under_review'
    WHEN 'materials_requested' THEN 'preparing'
    WHEN 'materials_approved' THEN 'preparing'
    WHEN 'materials_partial' THEN 'preparing'
    WHEN 'materials_rejected' THEN 'under_review'
    WHEN 'in_production' THEN 'manufacturing'
    WHEN 'quality_check' THEN 'manufacturing'
    WHEN 'completed' THEN 'ready'
    WHEN 'delivery_pending_customer' THEN 'ready'
    WHEN 'delivery_pending_warehouse' THEN 'ready'
    WHEN 'delivered_customer' THEN 'delivered'
    WHEN 'delivered_warehouse' THEN 'ready'
    WHEN 'cancelled' THEN 'cancelled'
    ELSE 'under_review'
  END;
  IF TG_OP = 'INSERT' OR OLD.workflow_status IS DISTINCT FROM NEW.workflow_status THEN
    INSERT INTO workflow_events (
      workflow_order_id, internal_status, customer_status, automatic, cause, created_at
    ) VALUES (
      NEW.id, NEW.workflow_status, public_status, true,
      CASE WHEN TG_OP = 'INSERT' THEN 'workflow_created' ELSE 'workflow_status_changed' END,
      now()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS production_workflow_customer_event ON production_workflow_orders;
CREATE TRIGGER production_workflow_customer_event
AFTER INSERT OR UPDATE OF workflow_status ON production_workflow_orders
FOR EACH ROW EXECUTE FUNCTION record_workflow_customer_event();