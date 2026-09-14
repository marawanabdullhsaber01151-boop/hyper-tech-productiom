-- Phase 3 (Portal Identity, Multi-Product Orders, Due Dates & Delivery
-- Rules): due-date suggestion/override trail, reference-only pricing,
-- delivery-method suggestion/override trail, and cancellation audit
-- fields on production_workflow_orders; plus the new settings-backed
-- delivery_method_rules table. See CHANGE-MANIFEST-PHASE-3.md for the
-- full explanation of each field and the formulas that populate them.

ALTER TABLE production_workflow_orders
  ADD COLUMN IF NOT EXISTS suggested_due_date date,
  ADD COLUMN IF NOT EXISTS due_date_overridden_by_id integer,
  ADD COLUMN IF NOT EXISTS due_date_overridden_by_name text,
  ADD COLUMN IF NOT EXISTS due_date_override_reason text,
  ADD COLUMN IF NOT EXISTS due_date_overridden_at timestamptz,
  ADD COLUMN IF NOT EXISTS reference_unit_price numeric(12, 2),
  ADD COLUMN IF NOT EXISTS reference_line_total numeric(12, 2),
  ADD COLUMN IF NOT EXISTS suggested_delivery_method text,
  ADD COLUMN IF NOT EXISTS delivery_method_overridden_by_id integer,
  ADD COLUMN IF NOT EXISTS delivery_method_overridden_by_name text,
  ADD COLUMN IF NOT EXISTS delivery_method_override_reason text,
  ADD COLUMN IF NOT EXISTS delivery_method_overridden_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by_id integer,
  ADD COLUMN IF NOT EXISTS cancelled_by_name text,
  ADD COLUMN IF NOT EXISTS cancelled_by_role text,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

CREATE TABLE IF NOT EXISTS delivery_method_rules (
  id serial PRIMARY KEY,
  label text NOT NULL,
  min_qty numeric(12, 3),
  max_qty numeric(12, 3),
  min_value numeric(12, 2),
  max_value numeric(12, 2),
  timing text NOT NULL DEFAULT 'any',
  delivery_method text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed one always-matching fallback rule so the system has a sane default
-- from day one (operators can edit/replace this from Settings — nothing
-- here is hard-coded in application code).
INSERT INTO delivery_method_rules (label, timing, delivery_method, priority)
SELECT 'افتراضي — استلام من المخزن', 'any', 'warehouse', 1000
WHERE NOT EXISTS (SELECT 1 FROM delivery_method_rules);
