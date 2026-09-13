-- Hyper-Tech ERP: revocable reference-token sessions for portal customers.
-- session_token is the raw bearer token; it is never a JWT or a password.

CREATE TABLE IF NOT EXISTS portal_sessions (
  id serial PRIMARY KEY,
  portal_customer_id integer NOT NULL,
  session_token text NOT NULL,
  remember_me boolean NOT NULL DEFAULT false,
  device_label text,
  ip_address text,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_sessions_session_token_unique UNIQUE (session_token),
  CONSTRAINT portal_sessions_customer_fk
    FOREIGN KEY (portal_customer_id) REFERENCES portal_customers(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS portal_sessions_customer_idx
  ON portal_sessions (portal_customer_id);
CREATE INDEX IF NOT EXISTS portal_sessions_expiry_idx
  ON portal_sessions (expires_at);