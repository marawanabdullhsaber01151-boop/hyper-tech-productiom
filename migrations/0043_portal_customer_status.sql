ALTER TABLE portal_customers
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS portal_customers_is_active_idx
  ON portal_customers(is_active);