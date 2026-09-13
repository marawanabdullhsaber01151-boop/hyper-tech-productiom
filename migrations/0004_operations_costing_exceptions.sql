-- Production traceability, costing entries, exceptions, and document versions.
CREATE TABLE IF NOT EXISTS production_batches (
  id serial PRIMARY KEY,
  workflow_order_id integer NOT NULL REFERENCES production_workflow_orders(id),
  batch_number text NOT NULL UNIQUE,
  planned_qty numeric(14,3) NOT NULL,
  produced_qty numeric(14,3) NOT NULL DEFAULT 0,
  accepted_qty numeric(14,3) NOT NULL DEFAULT 0,
  rework_qty numeric(14,3) NOT NULL DEFAULT 0,
  scrap_qty numeric(14,3) NOT NULL DEFAULT 0,
  stage text NOT NULL DEFAULT 'manufacturing',
  status text NOT NULL DEFAULT 'open',
  scrap_reason text,
  started_at timestamptz,
  completed_at timestamptz,
  created_by integer NOT NULL REFERENCES system_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS production_batches_order_idx ON production_batches(workflow_order_id, status);

CREATE TABLE IF NOT EXISTS production_cost_entries (
  id serial PRIMARY KEY,
  workflow_order_id integer NOT NULL REFERENCES production_workflow_orders(id),
  batch_id integer REFERENCES production_batches(id),
  cost_type text NOT NULL,
  amount numeric(14,2) NOT NULL,
  quantity numeric(14,3),
  unit_rate numeric(14,4),
  source_type text,
  source_id integer,
  note text,
  created_by integer NOT NULL REFERENCES system_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS production_cost_entries_order_type_idx ON production_cost_entries(workflow_order_id, cost_type);

CREATE TABLE IF NOT EXISTS production_exceptions (
  id serial PRIMARY KEY,
  exception_type text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  resource_type text NOT NULL,
  resource_id integer NOT NULL,
  title text NOT NULL,
  details jsonb,
  status text NOT NULL DEFAULT 'open',
  assigned_to integer REFERENCES system_users(id),
  root_cause text,
  resolution text,
  created_by integer NOT NULL REFERENCES system_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by integer REFERENCES system_users(id)
);
CREATE INDEX IF NOT EXISTS production_exceptions_queue_idx ON production_exceptions(status, severity, created_at);

CREATE TABLE IF NOT EXISTS document_revisions (
  id serial PRIMARY KEY,
  resource_type text NOT NULL,
  resource_id integer NOT NULL,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  change_reason text NOT NULL,
  changed_by integer NOT NULL REFERENCES system_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_revisions_document_idx ON document_revisions(resource_type, resource_id, version);