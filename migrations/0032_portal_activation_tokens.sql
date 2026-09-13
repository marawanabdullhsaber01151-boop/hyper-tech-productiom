-- Hyper-Tech ERP: one-time first-activation token records.
-- The raw token is intentionally not represented in this table.

CREATE TABLE IF NOT EXISTS portal_activation_tokens (
  id serial PRIMARY KEY,
  portal_customer_id integer NOT NULL,
  token_hash text NOT NULL,
  purpose text NOT NULL DEFAULT 'first_activation',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_activation_tokens_purpose_check
    CHECK (purpose IN ('first_activation')),
  CONSTRAINT portal_activation_tokens_customer_fk
    FOREIGN KEY (portal_customer_id) REFERENCES portal_customers(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS portal_activation_tokens_customer_idx
  ON portal_activation_tokens (portal_customer_id);
CREATE INDEX IF NOT EXISTS portal_activation_tokens_expiry_idx
  ON portal_activation_tokens (expires_at);