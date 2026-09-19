-- Phase 04 (delivery 1): engineering product-version governance.
--
-- IMPORTANT FINDING recorded here so it is not lost: engineering_products /
-- engineering_product_versions / engineering_routings (migration 0022)
-- already existed, but nothing in src/routes/production-workflow.ts (or
-- anywhere else) reads from them — production orders are created and
-- driven entirely by bom_recipes (an older, ungoverned, flat table with no
-- status/version/approval columns at all). This migration and the
-- accompanying code make the engineering module itself properly governed
-- (structured components, validation, an immutable release snapshot); it
-- does NOT rewire production order creation to consume it, because that is
-- a separate, materially riskier, cross-cutting change this delivery does
-- not attempt without a real database to verify it against. See the
-- Phase 04 delivery 1 report for the full explanation.

-- Structured BOM components, replacing the untyped bom_snapshot jsonb array
-- as the *editable* representation for draft/in_review versions.
-- bom_snapshot stays on engineering_product_versions as the immutable
-- record of exactly what these rows looked like at the moment a version
-- was released (see freezeVersionSnapshot in src/lib/engineering-governance.ts).
CREATE TABLE IF NOT EXISTS engineering_bom_components (
  id serial PRIMARY KEY,
  product_version_id integer NOT NULL
    REFERENCES engineering_product_versions(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  component_type text NOT NULL DEFAULT 'raw_material',
  -- Exactly one of these two is set: a component either consumes a
  -- Foundation item directly, or is itself a sub-assembly produced by
  -- another engineering product (enabling real BOM-cycle detection, which
  -- is impossible against an untyped jsonb blob).
  foundation_item_id integer REFERENCES foundation_items(id) ON DELETE RESTRICT,
  sub_assembly_product_id integer REFERENCES engineering_products(id) ON DELETE RESTRICT,
  qty numeric(14,4) NOT NULL,
  unit text NOT NULL,
  scrap_factor_pct numeric(6,3) NOT NULL DEFAULT 0,
  is_alternate boolean NOT NULL DEFAULT false,
  alternate_group text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engineering_bom_components_one_source CHECK (
    (foundation_item_id IS NOT NULL)::int + (sub_assembly_product_id IS NOT NULL)::int = 1
  ),
  CONSTRAINT engineering_bom_components_positive_qty CHECK (qty > 0),
  CONSTRAINT engineering_bom_components_scrap_range CHECK (
    scrap_factor_pct >= 0 AND scrap_factor_pct < 100
  )
);

CREATE INDEX IF NOT EXISTS engineering_bom_components_version_idx
  ON engineering_bom_components(product_version_id);
CREATE INDEX IF NOT EXISTS engineering_bom_components_subassembly_idx
  ON engineering_bom_components(sub_assembly_product_id)
  WHERE sub_assembly_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS engineering_bom_components_foundation_item_idx
  ON engineering_bom_components(foundation_item_id)
  WHERE foundation_item_id IS NOT NULL;

-- Governance columns for the draft/in_review/approved/released/superseded/
-- retired lifecycle (the previous status column only ever received
-- 'draft' or 'approved' from application code — see src/routes/engineering.ts
-- before this delivery).
ALTER TABLE engineering_product_versions
  ADD COLUMN IF NOT EXISTS validation_status text NOT NULL DEFAULT 'not_validated',
  ADD COLUMN IF NOT EXISTS validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS validation_issues jsonb,
  ADD COLUMN IF NOT EXISTS released_by integer REFERENCES system_users(id),
  ADD COLUMN IF NOT EXISTS released_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by_version_id integer
    REFERENCES engineering_product_versions(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'engineering_product_versions_status_check'
  ) THEN
    ALTER TABLE engineering_product_versions
      ADD CONSTRAINT engineering_product_versions_status_check
      CHECK (status IN ('draft', 'in_review', 'approved', 'released', 'superseded', 'retired'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'engineering_product_versions_validation_check'
  ) THEN
    ALTER TABLE engineering_product_versions
      ADD CONSTRAINT engineering_product_versions_validation_check
      CHECK (validation_status IN ('not_validated', 'passed', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS engineering_product_versions_released_idx
  ON engineering_product_versions(product_id)
  WHERE status = 'released';
