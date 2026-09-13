-- Hyper-Tech ERP: one portal account per existing contact.
-- The application also checks this inside its transaction; this constraint
-- protects the invariant against concurrent requests and other code paths.
CREATE UNIQUE INDEX IF NOT EXISTS portal_customers_contact_id_unique
  ON portal_customers (contact_id);