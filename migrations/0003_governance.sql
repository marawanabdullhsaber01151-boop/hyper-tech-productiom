-- Governance layer: scoped delegation, approval policy/request tracking, and immutable audit trail.
CREATE TABLE IF NOT EXISTS delegations (
  id serial PRIMARY KEY,
  grantor_user_id integer NOT NULL REFERENCES system_users(id),
  delegate_user_id integer NOT NULL REFERENCES system_users(id),
  action_key text NOT NULL,
  scope_type text NOT NULL DEFAULT 'company',
  scope_id text,
  max_amount numeric(14,2),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by integer REFERENCES system_users(id)
);
CREATE INDEX IF NOT EXISTS delegations_delegate_action_idx ON delegations(delegate_user_id, action_key);
CREATE INDEX IF NOT EXISTS delegations_active_window_idx ON delegations(status, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS approval_policies (
  id serial PRIMARY KEY,
  action_key text NOT NULL,
  min_amount numeric(14,2) NOT NULL DEFAULT 0,
  approver_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  sequence integer NOT NULL DEFAULT 1,
  required_approvals integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS approval_policies_lookup_idx ON approval_policies(action_key, min_amount, active);

CREATE TABLE IF NOT EXISTS approval_requests (
  id serial PRIMARY KEY,
  action_key text NOT NULL,
  resource_type text NOT NULL,
  resource_id integer NOT NULL,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  requested_by integer NOT NULL REFERENCES system_users(id),
  status text NOT NULL DEFAULT 'pending',
  current_step integer NOT NULL DEFAULT 1,
  metadata jsonb,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS approval_requests_resource_idx ON approval_requests(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS approval_requests_pending_idx ON approval_requests(status, action_key);

CREATE TABLE IF NOT EXISTS audit_events (
  id serial PRIMARY KEY,
  actor_user_id integer REFERENCES system_users(id) ON DELETE SET NULL,
  actor_name text,
  action_key text NOT NULL,
  resource_type text NOT NULL,
  resource_id integer,
  before_data jsonb,
  after_data jsonb,
  decision text NOT NULL DEFAULT 'executed',
  reason text,
  delegation_id integer,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_resource_idx ON audit_events(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS audit_events_actor_idx ON audit_events(actor_user_id, created_at);