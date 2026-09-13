-- Hyper-Tech ERP: activation requests for existing customers entering the portal
-- for the first time. Matching is advisory and never grants access by itself.

CREATE TABLE IF NOT EXISTS portal_activation_requests (
  id serial PRIMARY KEY,
  company_name_entered text NOT NULL,
  phone_entered text NOT NULL,
  matched_contact_id integer,
  matched_portal_customer_id integer,
  status text NOT NULL DEFAULT 'pending',
  decided_by_user_id integer,
  decided_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_activation_requests_status_check
    CHECK (status IN ('pending', 'confirmed', 'rejected')),
  CONSTRAINT portal_activation_requests_contact_fk
    FOREIGN KEY (matched_contact_id) REFERENCES contacts(id)
    ON DELETE SET NULL,
  CONSTRAINT portal_activation_requests_customer_fk
    FOREIGN KEY (matched_portal_customer_id) REFERENCES portal_customers(id)
    ON DELETE SET NULL,
  CONSTRAINT portal_activation_requests_decider_fk
    FOREIGN KEY (decided_by_user_id) REFERENCES system_users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS portal_activation_requests_phone_idx
  ON portal_activation_requests (phone_entered);
CREATE INDEX IF NOT EXISTS portal_activation_requests_status_idx
  ON portal_activation_requests (status);