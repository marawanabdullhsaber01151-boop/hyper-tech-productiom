ALTER TABLE system_users
  ADD COLUMN IF NOT EXISTS max_concurrent_sessions integer;