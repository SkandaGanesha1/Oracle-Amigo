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
  mode TEXT NOT NULL DEFAULT 'single-device',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
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
