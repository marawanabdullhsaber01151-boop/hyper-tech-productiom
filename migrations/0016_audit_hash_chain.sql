ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS prev_hash text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS record_hash text;
UPDATE audit_events SET record_hash = '' WHERE record_hash IS NULL;
ALTER TABLE audit_events ALTER COLUMN record_hash SET DEFAULT '';
ALTER TABLE audit_events ALTER COLUMN record_hash SET NOT NULL;