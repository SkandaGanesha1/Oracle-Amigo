ALTER TABLE relay_tasks
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stored_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS waiting_approval_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS transfer_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE relay_messages
  ADD COLUMN IF NOT EXISTS acked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'relay_tasks'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE relay_tasks DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'relay_messages'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE relay_messages DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

UPDATE relay_tasks
SET
  status = CASE status
    WHEN 'pending' THEN 'queued'
    WHEN 'delivered' THEN 'delivered_to_remote_agent'
    WHEN 'cancelled' THEN 'failed'
    ELSE status
  END,
  accepted_at = COALESCE(accepted_at, created_at),
  queued_at = CASE WHEN status IN ('pending', 'queued') THEN COALESCE(queued_at, created_at) ELSE queued_at END,
  failed_at = CASE WHEN status = 'cancelled' THEN COALESCE(failed_at, updated_at, created_at) ELSE failed_at END,
  last_error = CASE WHEN status = 'cancelled' THEN COALESCE(last_error, 'cancelled before relay delivery semantics migration') ELSE last_error END,
  expired_at = CASE WHEN status = 'expired' THEN COALESCE(expired_at, updated_at, created_at) ELSE expired_at END;

UPDATE relay_messages
SET
  status = CASE status
    WHEN 'pending' THEN 'queued'
    ELSE status
  END,
  expires_at = COALESCE(expires_at, (
    SELECT t.expires_at
    FROM relay_tasks t
    WHERE t.id = relay_messages.relay_task_id
  ));

ALTER TABLE relay_tasks
  ADD CONSTRAINT relay_tasks_status_check
  CHECK (status IN ('accepted', 'queued', 'delivered_to_remote_agent', 'stored_by_remote_agent', 'waiting_approval', 'approved', 'transfer_started', 'completed', 'failed', 'expired'));

ALTER TABLE relay_messages
  ADD CONSTRAINT relay_messages_status_check
  CHECK (status IN ('queued', 'delivered', 'acked', 'responded', 'failed', 'expired'));

CREATE INDEX IF NOT EXISTS idx_relay_tasks_org_queued ON relay_tasks(org_id, to_agent_instance_id, next_retry_at, created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_relay_tasks_org_retry ON relay_tasks(org_id, to_agent_instance_id, next_retry_at, attempt_count) WHERE status IN ('queued', 'delivered_to_remote_agent');
CREATE INDEX IF NOT EXISTS idx_relay_tasks_org_dead_letter ON relay_tasks(org_id, status, failed_at, created_at) WHERE status IN ('failed', 'expired');
CREATE INDEX IF NOT EXISTS idx_relay_tasks_org_expires ON relay_tasks(org_id, expires_at) WHERE status IN ('accepted', 'queued', 'delivered_to_remote_agent');
CREATE INDEX IF NOT EXISTS idx_relay_messages_org_inbox_queued ON relay_messages(org_id, to_agent_instance_id, created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_relay_messages_org_inbox_retry ON relay_messages(org_id, to_agent_instance_id, delivered_at, created_at) WHERE status IN ('queued', 'delivered');
