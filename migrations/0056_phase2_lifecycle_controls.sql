-- Phase 02 (second delivery): explicit lifecycle consequences and query paths.
-- Additive and idempotent. No legacy production row is deleted or rewritten.

CREATE TABLE IF NOT EXISTS production_lifecycle_adjustments (
  id SERIAL PRIMARY KEY,
  workflow_order_id INTEGER NOT NULL
    REFERENCES production_workflow_orders(id) ON DELETE CASCADE,
  related_workflow_order_id INTEGER
    REFERENCES production_workflow_orders(id) ON DELETE SET NULL,
  adjustment_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  quantity TEXT,
  reason TEXT NOT NULL,
  evidence JSONB,
  actor_user_id INTEGER REFERENCES system_users(id),
  actor_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS production_lifecycle_adjustments_order_idx
  ON production_lifecycle_adjustments(workflow_order_id, created_at);

CREATE INDEX IF NOT EXISTS production_lifecycle_adjustments_type_idx
  ON production_lifecycle_adjustments(adjustment_type, created_at);

-- These are intentionally NOT VALID so existing historical rows do not make
-- the deployment fail. New application writes are validated by the API.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'production_workflow_canonical_source_type_check'
  ) THEN
    ALTER TABLE production_workflow_orders
      ADD CONSTRAINT production_workflow_canonical_source_type_check
      CHECK (
        canonical_source_type IS NULL OR canonical_source_type IN (
          'direct_workflow',
          'production_request',
          'operations_case',
          'sales_order',
          'legacy_production_order',
          'split_order'
        )
      ) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS production_workflow_root_order_idx
  ON production_workflow_orders(root_workflow_order_id, split_sequence);

CREATE INDEX IF NOT EXISTS production_workflow_source_lookup_idx
  ON production_workflow_orders(canonical_source_type, canonical_source_id);

CREATE INDEX IF NOT EXISTS production_transition_events_order_revision_idx
  ON production_transition_events(workflow_order_id, revision);
