-- Phase 4: Operations Manager dual-trigger intake gate.
--
-- The status and owner are stored on each production line. The partial index
-- makes the intended invariant visible to PostgreSQL and keeps the claim
-- lookup cheap; the atomic UPDATE in src/lib/operations-claim.ts is the
-- concurrency enforcement.

ALTER TABLE production_workflow_orders
  ADD COLUMN IF NOT EXISTS claimed_by_id integer,
  ADD COLUMN IF NOT EXISTS claimed_by_name text,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

ALTER TABLE production_workflow_orders
  ALTER COLUMN workflow_status SET DEFAULT 'awaiting_operations_claim';

CREATE INDEX IF NOT EXISTS production_workflow_orders_operations_claim_idx
  ON production_workflow_orders (workflow_status, id)
  WHERE workflow_status = 'awaiting_operations_claim'
    AND claimed_by_id IS NULL;

-- Existing "new" rows were waiting for the old production-manager handoff.
-- Move them to the explicit Phase 4 boundary rather than allowing an old row
-- to bypass the claim gate. No terminal or in-progress row is touched.
UPDATE production_workflow_orders
SET workflow_status = 'awaiting_operations_claim',
    updated_at = now()
WHERE workflow_status = 'new';