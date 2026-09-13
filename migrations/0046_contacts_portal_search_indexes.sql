-- Hyper-Tech ERP: indexes for contact and portal-customer administration.
-- These are additive and safe to apply repeatedly.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS segment text;

CREATE INDEX IF NOT EXISTS contacts_phone_idx
  ON contacts (phone);

CREATE INDEX IF NOT EXISTS contacts_company_idx
  ON contacts (company);

CREATE INDEX IF NOT EXISTS portal_customers_full_name_idx
  ON portal_customers (full_name);

CREATE INDEX IF NOT EXISTS portal_customers_company_name_idx
  ON portal_customers (company_name);

CREATE INDEX IF NOT EXISTS portal_customers_created_at_idx
  ON portal_customers (created_at DESC);