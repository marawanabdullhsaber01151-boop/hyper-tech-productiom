-- Operations Manager list filters: keep priority filtering index-backed.
-- Status, assigned_to, due_date, updated_at, and sales_order_id already have
-- dedicated indexes in the operations-control migrations.
CREATE INDEX IF NOT EXISTS operations_cases_priority_idx
  ON operations_cases(priority);