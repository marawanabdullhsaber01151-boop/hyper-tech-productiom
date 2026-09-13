-- Approval matrix support is data-driven; existing tables already contain
-- sequence, required_approvals and current_step.
CREATE INDEX IF NOT EXISTS approval_requests_action_status_idx
  ON approval_requests (action_key, status);