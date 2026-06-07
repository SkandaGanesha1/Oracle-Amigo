-- Oracle Amigo Cloud Control Plane Schema
-- Multi-tenant: every domain table includes org_id

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled', 'pending')),
  created_at TEXT NOT NULL,
  UNIQUE(org_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_org_email ON users(org_id, email);

CREATE TABLE IF NOT EXISTS user_credentials (
  user_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  password_algo TEXT NOT NULL DEFAULT 'argon2id',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  device_id TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  os TEXT,
  os_version TEXT,
  public_key TEXT NOT NULL,
  public_key_fingerprint TEXT NOT NULL,
  did TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled', 'revoked')),
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  UNIQUE(org_id, public_key_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_devices_org_user ON devices(org_id, user_id);

CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_device ON device_tokens(device_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_hash ON device_tokens(token_hash);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  UNIQUE(org_id, owner_user_id, display_name)
);

CREATE INDEX IF NOT EXISTS idx_agents_org_owner ON agents(org_id, owner_user_id);

CREATE TABLE IF NOT EXISTS agent_instances (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  agent_card_json TEXT NOT NULL,
  agent_card_hash TEXT NOT NULL,
  relay_inbox_id TEXT NOT NULL UNIQUE,
  version TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled', 'revoked')),
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  UNIQUE(org_id, agent_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_instances_org_agent ON agent_instances(org_id, agent_id, user_id, status);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  requester_user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'blocked', 'declined')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(org_id, requester_user_id, target_user_id)
);

CREATE INDEX IF NOT EXISTS idx_contacts_org_requester_status ON contacts(org_id, requester_user_id, status);

CREATE TABLE IF NOT EXISTS presence (
  agent_instance_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('online', 'stale', 'offline', 'revoked')),
  last_heartbeat_at TEXT NOT NULL,
  current_version TEXT,
  capabilities_json TEXT,
  agent_card_hash TEXT,
  local_queue_depth INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_presence_org_status_heartbeat ON presence(org_id, status, last_heartbeat_at);

CREATE TABLE IF NOT EXISTS relay_tasks (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  from_agent_instance_id TEXT NOT NULL,
  to_agent_instance_id TEXT NOT NULL,
  a2a_task_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'completed', 'cancelled', 'expired')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  delivered_at TEXT,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_relay_tasks_to_status ON relay_tasks(org_id, to_agent_instance_id, status);
CREATE INDEX IF NOT EXISTS idx_relay_tasks_from ON relay_tasks(org_id, from_agent_instance_id);

CREATE TABLE IF NOT EXISTS relay_messages (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  relay_task_id TEXT,
  from_agent_instance_id TEXT NOT NULL,
  to_agent_instance_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'acked', 'responded', 'expired')),
  idempotency_key TEXT,
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  UNIQUE(org_id, from_agent_instance_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_relay_messages_to_status ON relay_messages(org_id, to_agent_instance_id, status);

CREATE TABLE IF NOT EXISTS file_transfers (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  relay_task_id TEXT,
  from_agent_instance_id TEXT NOT NULL,
  to_agent_instance_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  encryption_key_id TEXT,
  encryption_algo TEXT,
  status TEXT NOT NULL CHECK (status IN ('initialized', 'uploading', 'ready', 'downloading', 'completed', 'expired', 'failed')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_file_transfers_to_status ON file_transfers(org_id, to_agent_instance_id, status);

CREATE TABLE IF NOT EXISTS transfer_encryption_keys (
  id TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  wrapped_key TEXT NOT NULL,
  iv TEXT NOT NULL,
  aad TEXT NOT NULL,
  algo TEXT NOT NULL DEFAULT 'AES-256-GCM',
  created_at TEXT NOT NULL,
  FOREIGN KEY (transfer_id) REFERENCES file_transfers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transfer_keys_transfer ON transfer_encryption_keys(transfer_id);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  actor_user_id TEXT,
  actor_agent_instance_id TEXT,
  event_type TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  previous_hash TEXT,
  event_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_org_created ON audit_events(org_id, created_at);

-- Admin Portal: dedicated operator accounts (do NOT reuse `users` to keep auth/UX boundaries clean).
-- Phase 15b: separate port + Argon2id password + TOTP 2FA + recovery codes + HttpOnly session cookies.
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_algo TEXT NOT NULL DEFAULT 'argon2id',
  is_disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- TOTP secrets are encrypted at rest with ADMIN_KEK (AES-256-GCM).
-- secret_encrypted stores "iv:ciphertext:tag" (base64url each segment).
CREATE TABLE IF NOT EXISTS admin_totp_secrets (
  admin_user_id TEXT PRIMARY KEY REFERENCES admin_users(id) ON DELETE CASCADE,
  secret_encrypted TEXT NOT NULL,
  enrolled_at TEXT NOT NULL,
  last_used_counter INTEGER NOT NULL DEFAULT 0
);

-- Recovery codes: 10 per admin, each 10 Crockford-base32 chars. We store sha256(normalized_code)
-- in code_hash. used_at is set on first use; the entire batch is rotated on use.
CREATE TABLE IF NOT EXISTS admin_recovery_codes (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recovery_user ON admin_recovery_codes(admin_user_id);

-- Opaque session tokens (no JWT, no JWT signature secrets at the edge). Cookie value is the
-- raw token; we only persist its sha256 in token_hash. Idle TTL enforced via last_seen_at.
CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON admin_sessions(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON admin_sessions(expires_at);

-- Sliding-window login attempt counter (per email + per ip). Used for lockout.
CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_lower TEXT NOT NULL,
  ip_address TEXT,
  succeeded INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_email_time ON admin_login_attempts(email_lower, created_at);
CREATE INDEX IF NOT EXISTS idx_attempts_ip_time ON admin_login_attempts(ip_address, created_at);

-- One-shot setup challenge used by /v1/admin/auth/setup/start. The server generates a TOTP secret,
-- encrypts it at rest with the admin KEK, and returns only a setup_challenge token + provisioning URI
-- to the client. The client later POSTs that token + email + password + display_name + totp_code back
-- to /v1/admin/auth/setup which looks up the secret by token_hash. TTL is 10 minutes; one-shot.
CREATE TABLE IF NOT EXISTS admin_setup_challenges (
  id TEXT PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  totp_secret_encrypted TEXT NOT NULL,
  provisioning_uri TEXT NOT NULL,
  secret_base32 TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_setup_challenges_expires ON admin_setup_challenges(expires_at);
