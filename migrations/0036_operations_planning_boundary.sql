-- Keep Operations Control in planning-only mode until approved dispatch
-- and the Operations Case/Snapshot model are implemented.
INSERT INTO system_settings (key, value, updated_at)
VALUES ('operations_control.planning_only', 'true', now())
ON CONFLICT (key) DO NOTHING;