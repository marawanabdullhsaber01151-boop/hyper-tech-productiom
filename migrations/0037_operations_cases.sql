ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;

ALTER TABLE sales_order_items
  ADD COLUMN IF NOT EXISTS base_unit TEXT NOT NULL DEFAULT 'unit',
  ADD COLUMN IF NOT EXISTS packaging_qty NUMERIC(12, 3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS packaging_unit TEXT NOT NULL DEFAULT 'carton',
  ADD COLUMN IF NOT EXISTS conversion_factor NUMERIC(12, 6) NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS operations_cases (
  id SERIAL PRIMARY KEY,
  case_number TEXT NOT NULL UNIQUE,
  sales_order_id INTEGER NOT NULL REFERENCES sales_orders(id),
  sales_order_revision INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  priority TEXT NOT NULL DEFAULT 'normal',
  due_date DATE,
  assigned_to INTEGER REFERENCES system_users(id),
  customer_id INTEGER REFERENCES contacts(id),
  customer_display_name TEXT,
  source_snapshot JSONB NOT NULL,
  current_revision INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER NOT NULL REFERENCES system_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT operations_cases_sales_revision_unique
    UNIQUE (sales_order_id, sales_order_revision)
);

CREATE INDEX IF NOT EXISTS operations_cases_status_idx
  ON operations_cases(status);

CREATE INDEX IF NOT EXISTS operations_cases_assigned_idx
  ON operations_cases(assigned_to);

CREATE TABLE IF NOT EXISTS operations_case_lines (
  id SERIAL PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES operations_cases(id) ON DELETE CASCADE,
  sales_order_item_id INTEGER REFERENCES sales_order_items(id) ON DELETE SET NULL,
  inventory_item_id INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
  product_name_snapshot TEXT NOT NULL,
  ordered_qty NUMERIC(18, 6) NOT NULL,
  base_unit TEXT NOT NULL DEFAULT 'unit',
  packaging_qty NUMERIC(18, 6) NOT NULL DEFAULT 0,
  packaging_unit TEXT NOT NULL DEFAULT 'carton',
  conversion_factor NUMERIC(18, 6) NOT NULL DEFAULT 1,
  due_date DATE,
  line_status TEXT NOT NULL DEFAULT 'received',
  CONSTRAINT operations_case_lines_case_item_unique
    UNIQUE (case_id, sales_order_item_id)
);

CREATE INDEX IF NOT EXISTS operations_case_lines_case_idx
  ON operations_case_lines(case_id);

CREATE TABLE IF NOT EXISTS operations_case_revisions (
  id SERIAL PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES operations_cases(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  change_reason TEXT,
  changed_by INTEGER NOT NULL REFERENCES system_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT operations_case_revisions_case_revision_unique
    UNIQUE (case_id, revision)
);

CREATE INDEX IF NOT EXISTS operations_case_revisions_case_idx
  ON operations_case_revisions(case_id, revision);

INSERT INTO phase0_number_sequences
  (sequence_key, prefix, next_value, padding, active, updated_at)
VALUES
  ('operations_case', 'OC-', 1, 6, TRUE, now())
ON CONFLICT (sequence_key) DO NOTHING;