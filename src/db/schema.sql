PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS local_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_display_name TEXT NOT NULL,
  user_email TEXT,
  agent_id TEXT NOT NULL UNIQUE,
  device_id TEXT NOT NULL UNIQUE,
  did TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  private_key_ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL UNIQUE,
  card_json TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '0.1.0',
  etag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS peer_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  peer_agent_id TEXT NOT NULL,
  peer_agent_instance_id TEXT NOT NULL DEFAULT '',
  peer_did TEXT NOT NULL,
  peer_agent_card_url TEXT,
  peer_public_key TEXT NOT NULL,
  trust_level TEXT NOT NULL DEFAULT 'local',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  local_agent_id TEXT NOT NULL,
  peer_agent_id TEXT,
  mode TEXT NOT NULL DEFAULT 'local',
  org_id TEXT,
  local_user_id TEXT,
  local_agent_instance_id TEXT,
  peer_user_id TEXT,
  peer_agent_instance_id TEXT,
  title TEXT NOT NULL DEFAULT 'Conversation',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_message_at TEXT,
  last_read_message_id TEXT,
  unread_count INTEGER NOT NULL DEFAULT 0,
  mention_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id TEXT NOT NULL,
  user_id TEXT,
  agent_instance_id TEXT,
  role TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id, role, agent_instance_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  a2a_task_id TEXT,
  sender_agent_id TEXT NOT NULL,
  receiver_agent_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content_text TEXT,
  content_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  task_id TEXT,
  sender_user_id TEXT,
  sender_agent_instance_id TEXT,
  receiver_agent_instance_id TEXT,
  message_type TEXT NOT NULL,
  text TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  delivery_status TEXT NOT NULL DEFAULT 'local_pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_created
  ON chat_messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS chat_message_reactions (
  message_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (message_id, actor_id, emoji),
  FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_message_reactions_message
  ON chat_message_reactions(message_id);

CREATE TABLE IF NOT EXISTS message_delivery_attempts (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',
  next_retry_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS a2a_tasks (
  id TEXT PRIMARY KEY,
  context_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  protocol_state TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS workflow_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  state_from TEXT NOT NULL,
  state_to TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS file_index_roots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_path TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_indexed_at TEXT,
  file_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS file_index_excludes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_path TEXT NOT NULL,
  exclude_path TEXT NOT NULL,
  exclude_type TEXT NOT NULL DEFAULT 'folder', -- 'folder' or 'pattern'
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS file_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_id TEXT NOT NULL,
  file_path TEXT NOT NULL UNIQUE,
  display_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  extension TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  modified_at TEXT NOT NULL,
  content_hash TEXT,
  indexed_text TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  last_indexed_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_file_index USING fts5(
  file_name,
  display_path,
  indexed_text,
  extension,
  metadata_text,
  content='file_index',
  content_rowid='id'
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  approval_type TEXT NOT NULL DEFAULT 'file.transfer.offer',
  requester_agent_id TEXT NOT NULL,
  owner_agent_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  selected_file_id TEXT,
  bound_file_path TEXT,
  bound_sha256 TEXT,
  bound_size_bytes INTEGER,
  feedback_text TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS approval_idempotency_keys (
  id TEXT PRIMARY KEY,
  approval_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  action TEXT NOT NULL,
  result_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(approval_id, idempotency_key),
  FOREIGN KEY (approval_id) REFERENCES approval_requests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transfers (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  from_agent_id TEXT NOT NULL,
  to_agent_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  transfer_mode TEXT NOT NULL DEFAULT 'local',
  status TEXT NOT NULL DEFAULT 'created',
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS inbox_item_state (
  item_id TEXT PRIMARY KEY,
  read_at TEXT,
  archived_at TEXT,
  snoozed_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS received_files (
  id TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL,
  sender_agent_id TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  original_file_name TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS file_previews (
  file_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'processing',
  source_mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  page_count INTEGER,
  thumb_360_path TEXT,
  thumb_720_path TEXT,
  width INTEGER,
  height INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (file_id) REFERENCES received_files(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS approval_transfer_jobs (
  id TEXT PRIMARY KEY,
  approval_id TEXT NOT NULL UNIQUE,
  task_id TEXT NOT NULL,
  relay_task_id TEXT,
  transfer_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (approval_id) REFERENCES approval_requests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  memory_type TEXT NOT NULL,
  namespace TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  content_text TEXT NOT NULL,
  content_json TEXT,
  importance REAL NOT NULL DEFAULT 0.5,
  decay_score REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  last_accessed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS episodic_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  embedding_ref TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_agent_id TEXT NOT NULL,
  task_id TEXT,
  approval_id TEXT,
  event_type TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  previous_hash TEXT NOT NULL,
  event_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_cloud_identity (
  profile_id TEXT PRIMARY KEY,
  control_plane_url TEXT NOT NULL,
  org_id TEXT,
  user_id TEXT,
  user_email TEXT,
  display_name TEXT,
  device_id TEXT,
  agent_id TEXT,
  agent_instance_id TEXT,
  relay_inbox_url TEXT,
  user_access_token TEXT,
  device_access_token TEXT,
  refresh_token TEXT,
  user_refresh_token TEXT,
  device_refresh_token TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_relay_dispatches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL,
  relay_task_id TEXT NOT NULL,
  a2a_task_id TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  local_task_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  error_text TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(profile_id, relay_task_id)
);

CREATE TABLE IF NOT EXISTS mission_threads (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  author_type TEXT NOT NULL,
  author_label TEXT NOT NULL,
  body TEXT NOT NULL,
  mentions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mission_threads_mission_created
  ON mission_threads(mission_id, created_at);

CREATE TABLE IF NOT EXISTS policy_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  role TEXT NOT NULL DEFAULT 'any',
  sensitivity TEXT NOT NULL DEFAULT 'any',
  file_extension TEXT NOT NULL DEFAULT 'any',
  mime_type TEXT NOT NULL DEFAULT 'any',
  transfer_direction TEXT NOT NULL DEFAULT 'any',
  max_file_size_bytes INTEGER,
  action TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS redaction_audit (
  id TEXT PRIMARY KEY,
  source_file_id TEXT NOT NULL,
  output_path TEXT NOT NULL,
  output_sha256 TEXT NOT NULL,
  redactions_json TEXT NOT NULL DEFAULT '[]',
  watermark_text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watermark_history (
  id TEXT PRIMARY KEY,
  redaction_id TEXT NOT NULL,
  recipient_label TEXT NOT NULL,
  watermark_text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_events (
  id TEXT PRIMARY KEY,
  source_event_id TEXT UNIQUE,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  entity_type TEXT,
  entity_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  conversation_id TEXT,
  message_id TEXT,
  sender_user_id TEXT,
  sender_agent_instance_id TEXT,
  bridge_error TEXT,
  shown_at TEXT,
  read_at TEXT,
  delivered INTEGER NOT NULL DEFAULT 0,
  bridge_available INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_events_source_event
  ON notification_events(source_event_id)
  WHERE source_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_agent_settings (
  profile_id TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS voice_commands (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  org_id TEXT,
  user_id TEXT,
  agent_id TEXT,
  agent_instance_id TEXT,
  transcript TEXT NOT NULL,
  source TEXT NOT NULL,
  locale TEXT,
  input_mode TEXT,
  stt_provider TEXT,
  stt_confidence REAL,
  confidence REAL,
  parser_provider TEXT,
  file_extensions_json TEXT NOT NULL DEFAULT '[]',
  target_user_id TEXT,
  target_agent_instance_id TEXT,
  parsed_intent TEXT NOT NULL,
  parsed_json TEXT NOT NULL DEFAULT '{}',
  preview_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  conversation_id TEXT,
  mission_id TEXT,
  relay_task_id TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_voice_commands_profile_created
  ON voice_commands(profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS voice_command_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_voice_command_events_command_created
  ON voice_command_events(command_id, created_at, id);

-- Tracks incoming file-request approvals on the RECEIVER side.
-- Created by ReceiverAgentOrchestrator when a relay file.request arrives.
CREATE TABLE IF NOT EXISTS receiver_approvals (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  relay_task_id TEXT NOT NULL,
  a2a_task_id TEXT NOT NULL,
  requester_agent_instance_id TEXT NOT NULL,
  requester_user_id TEXT,
  file_query TEXT NOT NULL,
  candidates_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',     -- pending | approved | rejected | transferred | failed
  selected_file_path TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_receiver_approvals_profile_status
  ON receiver_approvals(profile_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_receiver_approvals_relay_task
  ON receiver_approvals(relay_task_id);
