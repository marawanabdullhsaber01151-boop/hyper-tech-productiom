CREATE INDEX IF NOT EXISTS delegations_effective_lookup_idx
  ON delegations (delegate_user_id, action_key, status, starts_at, ends_at);