CREATE TABLE IF NOT EXISTS portal_order_batches (
  id SERIAL PRIMARY KEY,
  portal_customer_id INTEGER NOT NULL REFERENCES portal_customers(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  batch_ref text NOT NULL UNIQUE,
  response_payload JSONB,
  response_status INTEGER NOT NULL DEFAULT 201,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (portal_customer_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS portal_order_batches_customer_created_at_idx
  ON portal_order_batches(portal_customer_id, created_at);