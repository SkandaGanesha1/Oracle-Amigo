CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled', 'pending')),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(org_id, email)
);

CREATE TABLE IF NOT EXISTS user_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  password_algo TEXT NOT NULL DEFAULT 'argon2id',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  device_id TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_name TEXT NOT NULL,
  os TEXT,
  os_version TEXT,
  public_key TEXT NOT NULL,
  public_key_fingerprint TEXT NOT NULL,
  did TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ,
  UNIQUE(org_id, public_key_fingerprint)
);

CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(org_id, owner_user_id, display_name)
);

CREATE TABLE IF NOT EXISTS agent_instances (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_card_json TEXT NOT NULL,
  agent_card_hash TEXT NOT NULL,
  relay_inbox_id TEXT NOT NULL UNIQUE,
  version TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ,
  UNIQUE(org_id, agent_id, device_id)
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requester_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'blocked', 'declined')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(org_id, requester_user_id, target_user_id)
);

CREATE TABLE IF NOT EXISTS presence (
  agent_instance_id TEXT PRIMARY KEY REFERENCES agent_instances(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('online', 'stale', 'offline', 'revoked')),
  last_heartbeat_at TIMESTAMPTZ NOT NULL,
  current_version TEXT,
  capabilities_json TEXT,
  agent_card_hash TEXT,
  local_queue_depth INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS relay_tasks (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_agent_instance_id TEXT NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
  to_agent_instance_id TEXT NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
  a2a_task_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('accepted', 'queued', 'delivered_to_remote_agent', 'stored_by_remote_agent', 'waiting_approval', 'approved', 'transfer_started', 'completed', 'failed', 'expired')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  next_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  queued_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  stored_at TIMESTAMPTZ,
  waiting_approval_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  transfer_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS relay_messages (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  relay_task_id TEXT REFERENCES relay_tasks(id) ON DELETE CASCADE,
  from_agent_instance_id TEXT NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
  to_agent_instance_id TEXT NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'delivered', 'acked', 'responded', 'failed', 'expired')),
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  delivered_at TIMESTAMPTZ,
  acked_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  UNIQUE(org_id, from_agent_instance_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS file_transfers (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  relay_task_id TEXT REFERENCES relay_tasks(id) ON DELETE SET NULL,
  from_agent_instance_id TEXT NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
  to_agent_instance_id TEXT NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  encryption_key_id TEXT,
  encryption_algo TEXT,
  status TEXT NOT NULL CHECK (status IN ('initialized', 'uploading', 'ready', 'downloading', 'completed', 'expired', 'failed')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS transfer_encryption_keys (
  id TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL REFERENCES file_transfers(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  wrapped_key TEXT NOT NULL,
  iv TEXT NOT NULL,
  aad TEXT NOT NULL,
  algo TEXT NOT NULL DEFAULT 'AES-256-GCM',
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id TEXT,
  actor_agent_instance_id TEXT,
  event_type TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  previous_hash TEXT,
  event_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_algo TEXT NOT NULL DEFAULT 'argon2id',
  is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_totp_secrets (
  admin_user_id TEXT PRIMARY KEY REFERENCES admin_users(id) ON DELETE CASCADE,
  secret_encrypted TEXT NOT NULL,
  enrolled_at TIMESTAMPTZ NOT NULL,
  last_used_counter BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS admin_recovery_codes (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id BIGSERIAL PRIMARY KEY,
  email_lower TEXT NOT NULL,
  ip_address TEXT,
  succeeded BOOLEAN NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_setup_challenges (
  id TEXT PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  totp_secret_encrypted TEXT NOT NULL,
  provisioning_uri TEXT NOT NULL,
  secret_base32 TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_login_challenges (
  id TEXT PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  admin_user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);
