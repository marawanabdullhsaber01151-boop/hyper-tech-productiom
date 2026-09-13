ALTER TABLE production_cost_entries
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved';

CREATE INDEX IF NOT EXISTS production_cost_entries_status_idx
  ON production_cost_entries (status, workflow_order_id);