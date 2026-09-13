-- Hyper-Tech ERP: moderated onboarding requests for entirely new portal customers.
-- Additive migration; no existing portal route is changed by this DDL alone.

CREATE TABLE IF NOT EXISTS portal_applications (
  id serial PRIMARY KEY,
  reference_code text NOT NULL,
  full_name text NOT NULL,
  company_name text NOT NULL,
  phone text NOT NULL,
  email text,
  address text NOT NULL,
  commercial_register_no text,
  tax_id text,
  expected_monthly_volume text,
  notes text,
  status text NOT NULL DEFAULT 'pending',
  reviewer_note text,
  reviewed_by_user_id integer,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_applications_reference_code_unique UNIQUE (reference_code),
  CONSTRAINT portal_applications_status_check
    CHECK (status IN ('pending', 'needs_info', 'approved', 'rejected')),
  CONSTRAINT portal_applications_reviewer_fk
    FOREIGN KEY (reviewed_by_user_id) REFERENCES system_users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS portal_applications_phone_idx
  ON portal_applications (phone);
CREATE INDEX IF NOT EXISTS portal_applications_reference_code_idx
  ON portal_applications (reference_code);