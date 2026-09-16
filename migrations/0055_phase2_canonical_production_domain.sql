-- Phase 02 (first delivery): canonical production identity, frozen source
-- snapshots, transition evidence, and safe conversion boundaries.
-- Additive and idempotent. Existing workflow_status remains the compatibility
-- field used by the current API while lifecycle_revision becomes its sequence.

ALTER TABLE production_workflow_orders
  ADD COLUMN IF NOT EXISTS lifecycle_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS canonical_source_type text,
  ADD COLUMN IF NOT EXISTS canonical_source_id integer,
  ADD COLUMN IF NOT EXISTS canonical_source_revision integer,
  ADD COLUMN IF NOT EXISTS source_reference text,
  ADD COLUMN IF NOT EXISTS product_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS bom_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS routing_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS customer_requirement_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS quantity_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS due_date_snapshot date,
  ADD COLUMN IF NOT EXISTS priority_snapshot text,
  ADD COLUMN IF NOT EXISTS snapshot_hash text,
  ADD COLUMN IF NOT EXISTS root_workflow_order_id integer,
  ADD COLUMN IF NOT EXISTS split_sequence integer,
  ADD COLUMN IF NOT EXISTS closure_evidence jsonb,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by_id integer;

ALTER TABLE operations_cases
  ADD COLUMN IF NOT EXISTS workflow_order_id integer;

CREATE TABLE IF NOT EXISTS production_transition_events (
  id serial PRIMARY KEY,
  workflow_order_id integer NOT NULL
    REFERENCES production_workflow_orders(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  from_status text,
  to_status text NOT NULL,
  action_key text NOT NULL,
  actor_user_id integer,
  actor_name text,
  reason text,
  source text NOT NULL DEFAULT 'api',
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_transition_events_order_revision_unique
    UNIQUE (workflow_order_id, revision)
);

CREATE INDEX IF NOT EXISTS production_transition_events_order_created_idx
  ON production_transition_events(workflow_order_id, created_at);

CREATE TABLE IF NOT EXISTS production_legacy_order_mappings (
  id serial PRIMARY KEY,
  legacy_production_order_id integer NOT NULL,
  canonical_workflow_order_id integer
    REFERENCES production_workflow_orders(id) ON DELETE SET NULL,
  mapping_status text NOT NULL DEFAULT 'quarantined',
  evidence jsonb,
  legacy_snapshot jsonb,
  review_reason text,
  reviewed_by_id integer,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_legacy_order_mappings_legacy_unique
    UNIQUE (legacy_production_order_id)
);

CREATE INDEX IF NOT EXISTS production_legacy_order_mappings_status_idx
  ON production_legacy_order_mappings(mapping_status);

CREATE UNIQUE INDEX IF NOT EXISTS production_requests_workflow_order_unique
  ON production_requests(workflow_order_id)
  WHERE workflow_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS operations_cases_workflow_order_unique
  ON operations_cases(workflow_order_id)
  WHERE workflow_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS production_workflow_canonical_source_unique
  ON production_workflow_orders(
    canonical_source_type,
    canonical_source_id,
    canonical_source_revision
  )
  WHERE canonical_source_type IS NOT NULL
    AND canonical_source_id IS NOT NULL;

-- Existing request conversions are given an explicit source reference. Rows
-- that cannot be mapped one-to-one remain visible to the later audit phase.
UPDATE production_workflow_orders AS wo
SET canonical_source_type = 'production_request',
    canonical_source_id = pr.id,
    canonical_source_revision = 1,
    source_reference = pr.request_number,
    root_workflow_order_id = wo.id
FROM production_requests AS pr
WHERE pr.workflow_order_id = wo.id
  AND wo.canonical_source_type IS NULL;

UPDATE production_workflow_orders AS wo
SET product_snapshot = jsonb_build_object(
      'name', wo.product_name,
      'bomRecipeId', wo.bom_recipe_id
    ),
    quantity_snapshot = jsonb_build_object(
      'value', wo.qty,
      'unit', wo.unit
    ),
    due_date_snapshot = wo.needed_by,
    priority_snapshot = wo.priority
WHERE wo.product_snapshot IS NULL;

-- The application uses SHA-256 for new snapshots. md5 here is deliberately
-- marked as a legacy backfill value and is re-hashed during reconciliation.
UPDATE production_workflow_orders AS wo
SET snapshot_hash = md5(
  jsonb_build_object(
    'product', wo.product_snapshot,
    'quantity', wo.quantity_snapshot,
    'dueDate', wo.due_date_snapshot,
    'priority', wo.priority_snapshot
  )::text
)
WHERE wo.snapshot_hash IS NULL
  AND wo.product_snapshot IS NOT NULL;

INSERT INTO production_transition_events (
  workflow_order_id,
  revision,
  from_status,
  to_status,
  action_key,
  source,
  metadata
)
SELECT
  wo.id,
  wo.lifecycle_revision,
  NULL,
  wo.workflow_status,
  'phase2.snapshot_backfill',
  'migration',
  jsonb_build_object('backfilled', true)
FROM production_workflow_orders AS wo
WHERE NOT EXISTS (
  SELECT 1
  FROM production_transition_events AS pe
  WHERE pe.workflow_order_id = wo.id
    AND pe.revision = wo.lifecycle_revision
);

CREATE OR REPLACE FUNCTION increment_production_lifecycle_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.workflow_status IS DISTINCT FROM OLD.workflow_status THEN
    NEW.lifecycle_revision := OLD.lifecycle_revision + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS production_workflow_lifecycle_revision
  ON production_workflow_orders;

CREATE TRIGGER production_workflow_lifecycle_revision
BEFORE UPDATE OF workflow_status ON production_workflow_orders
FOR EACH ROW
EXECUTE FUNCTION increment_production_lifecycle_revision();