-- Hyper-Tech ERP: add the optional portal customer email column.
-- Safe to run after the earlier portal customer migrations.

ALTER TABLE portal_customers
  ADD COLUMN IF NOT EXISTS email text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'portal_customers_email_unique'
      AND conrelid = 'portal_customers'::regclass
  ) THEN
    ALTER TABLE portal_customers
      ADD CONSTRAINT portal_customers_email_unique UNIQUE (email);
  END IF;
END $$;