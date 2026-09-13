CREATE TABLE IF NOT EXISTS sod_rules (
  id serial PRIMARY KEY,
  action_key_create text NOT NULL,
  action_key_approve text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO sod_rules (action_key_create, action_key_approve)
SELECT 'purchases.create', 'purchases.approve'
WHERE NOT EXISTS (
  SELECT 1 FROM sod_rules
  WHERE action_key_create = 'purchases.create'
    AND action_key_approve = 'purchases.approve'
);

INSERT INTO sod_rules (action_key_create, action_key_approve)
SELECT 'accounting.create', 'accounting.approve'
WHERE NOT EXISTS (
  SELECT 1 FROM sod_rules
  WHERE action_key_create = 'accounting.create'
    AND action_key_approve = 'accounting.approve'
);

INSERT INTO sod_rules (action_key_create, action_key_approve)
SELECT 'sales.create', 'sales.approve'
WHERE NOT EXISTS (
  SELECT 1 FROM sod_rules
  WHERE action_key_create = 'sales.create'
    AND action_key_approve = 'sales.approve'
);