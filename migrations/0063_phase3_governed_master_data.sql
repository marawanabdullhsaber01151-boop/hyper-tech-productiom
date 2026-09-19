-- Phase 03 (delivery 3): governed master data for foundation_items —
-- lifecycle status, ownership, effective dates, version history, aliases,
-- a pending-change/approval slot, and a case-insensitive code constraint.
-- Additive and idempotent (IF NOT EXISTS everywhere). `active` stays as the
-- compatibility boolean every other module already reads; the application
-- layer keeps it in sync with `status` (status = 'active' <=> active = true)
-- rather than this migration trying to compute it, since existing `active`
-- values must not be reinterpreted without an explicit code path reviewing
-- them.

ALTER TABLE foundation_items
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS owner_id text,
  ADD COLUMN IF NOT EXISTS owner_name text,
  ADD COLUMN IF NOT EXISTS effective_from date,
  ADD COLUMN IF NOT EXISTS effective_to date,
  ADD COLUMN IF NOT EXISTS superseded_by_item_id integer
    REFERENCES foundation_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pending_change_payload jsonb,
  ADD COLUMN IF NOT EXISTS pending_change_reason text,
  ADD COLUMN IF NOT EXISTS pending_change_requested_by_id text,
  ADD COLUMN IF NOT EXISTS pending_change_requested_by_name text,
  ADD COLUMN IF NOT EXISTS pending_change_requested_at timestamptz;

-- Backfill status from the existing `active` boolean exactly once. Rows
-- that already have a status (re-running this migration, or a row created
-- by application code after this migration shipped but before the backfill
-- ran) are left untouched.
UPDATE foundation_items
  SET status = CASE WHEN active THEN 'active' ELSE 'retired' END
  WHERE status IS NULL;

ALTER TABLE foundation_items
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'foundation_items_status_check'
  ) THEN
    ALTER TABLE foundation_items
      ADD CONSTRAINT foundation_items_status_check
      CHECK (status IN ('draft', 'pending_approval', 'active', 'superseded', 'retired'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS foundation_items_status_idx ON foundation_items(status);

-- Duplicate-name detection, done with an indexed generated column instead
-- of scanning full rows into the application: name_normalized mirrors
-- normalizeForDuplicateMatch() in src/domain/foundation-governance.ts
-- (lowercase, collapse whitespace/dash/underscore/slash runs to one space,
-- drop periods/commas). Keeping the two in sync is a real maintenance cost
-- — see the comment on GET /foundation/items/duplicates for how the route
-- guards against them drifting apart. The partial index only covers
-- non-retired items, since a retired duplicate is not an active problem.
ALTER TABLE foundation_items
  ADD COLUMN IF NOT EXISTS name_normalized text
  GENERATED ALWAYS AS (
    btrim(regexp_replace(regexp_replace(lower(btrim(name)), '[\s\-_/]+', ' ', 'g'), '[.,]', '', 'g'))
  ) STORED;

CREATE INDEX IF NOT EXISTS foundation_items_name_normalized_active_idx
  ON foundation_items(name_normalized)
  WHERE status <> 'retired';

-- Version history: one row per change, holding the snapshot *before* the
-- change (same convention as foundation_audit.before_data), so "what did
-- this look like at version N" is a straight lookup, and current state
-- (version N+1) is just the live row.
CREATE TABLE IF NOT EXISTS foundation_item_versions (
  id serial PRIMARY KEY,
  item_id integer NOT NULL REFERENCES foundation_items(id) ON DELETE CASCADE,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  changed_by_id text,
  changed_by_name text,
  change_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT foundation_item_versions_item_version_unique UNIQUE (item_id, version)
);

CREATE INDEX IF NOT EXISTS foundation_item_versions_item_idx
  ON foundation_item_versions(item_id, created_at);

-- Aliases: alternate names/codes the same item is known by (legacy codes,
-- customer-facing names, supplier part numbers), used for duplicate-record
-- detection and search. One alias per item is case-insensitively unique so
-- the same alias cannot be attached twice to the same item by a race.
CREATE TABLE IF NOT EXISTS foundation_item_aliases (
  id serial PRIMARY KEY,
  item_id integer NOT NULL REFERENCES foundation_items(id) ON DELETE CASCADE,
  alias text NOT NULL,
  created_by_id text,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS foundation_item_aliases_item_alias_unique
  ON foundation_item_aliases(item_id, lower(alias));

-- Case-insensitive code uniqueness. The existing foundation_items_code_unique
-- index is case-sensitive, so "RM-001" and "rm-001" can coexist today —
-- exactly the kind of duplicate record Phase 03 is meant to catch. This
-- guard only adds the new, stricter index when no such collision already
-- exists; if one does, the migration logs it via RAISE NOTICE and a
-- quarantine table instead of failing outright, so a dirty dataset never
-- blocks every other change in this file from applying.
CREATE TABLE IF NOT EXISTS foundation_items_duplicate_code_review (
  id serial PRIMARY KEY,
  normalized_code text NOT NULL,
  item_ids integer[] NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved boolean NOT NULL DEFAULT false
);

DO $$
DECLARE
  collision_count integer;
BEGIN
  SELECT count(*) INTO collision_count
  FROM (
    SELECT lower(code) AS normalized_code
    FROM foundation_items
    GROUP BY lower(code)
    HAVING count(*) > 1
  ) dup;

  IF collision_count > 0 THEN
    INSERT INTO foundation_items_duplicate_code_review (normalized_code, item_ids)
    SELECT lower(code), array_agg(id ORDER BY id)
    FROM foundation_items
    GROUP BY lower(code)
    HAVING count(*) > 1;
    RAISE NOTICE 'foundation_items has % case-insensitive duplicate code group(s); see foundation_items_duplicate_code_review. Skipping the case-insensitive unique index until these are resolved.', collision_count;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE indexname = 'foundation_items_code_ci_unique'
    ) THEN
      CREATE UNIQUE INDEX foundation_items_code_ci_unique
        ON foundation_items(lower(code));
    END IF;
  END IF;
END $$;
