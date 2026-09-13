-- Hyper-Tech ERP: OTP password reset and customer-facing portal notifications.

CREATE TABLE IF NOT EXISTS portal_otp_codes (
  id serial PRIMARY KEY,
  portal_customer_id integer NOT NULL,
  channel text NOT NULL,
  code_hash text NOT NULL,
  purpose text NOT NULL DEFAULT 'password_reset',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_otp_codes_customer_fk
    FOREIGN KEY (portal_customer_id) REFERENCES portal_customers(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS portal_otp_customer_purpose_idx
  ON portal_otp_codes (portal_customer_id, purpose, created_at);
CREATE INDEX IF NOT EXISTS portal_otp_expiry_idx
  ON portal_otp_codes (expires_at);

CREATE TABLE IF NOT EXISTS portal_notifications (
  id serial PRIMARY KEY,
  portal_customer_id integer NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  reference_type text NOT NULL DEFAULT 'production_workflow',
  reference_id integer,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_notifications_customer_fk
    FOREIGN KEY (portal_customer_id) REFERENCES portal_customers(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS portal_notifications_customer_read_idx
  ON portal_notifications (portal_customer_id, is_read);
CREATE INDEX IF NOT EXISTS portal_notifications_customer_created_idx
  ON portal_notifications (portal_customer_id, created_at);