import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";

const SCHEMA_VERSION = 1;
const moduleDir = dirname(fileURLToPath(import.meta.url));
const schemaPathCandidates = [
  join(moduleDir, "schema.sql"),
  join(process.cwd(), "src", "db", "schema.sql"),
  join(process.cwd(), "dist", "src", "db", "schema.sql")
];

export function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  if (row.user_version < SCHEMA_VERSION) {
    const schema = readFileSync(resolveSchemaPath(), "utf8");
    db.exec(schema);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
  ensureLocalCloudTables(db);
  ensureChatTables(db);
  ensureApprovalTransferTables(db);
  ensureAnpTables(db);
  ensurePhaseFiveTables(db);
  ensureVoiceTables(db);
}

function resolveSchemaPath(): string {
  const schemaPath = schemaPathCandidates.find((candidate) => existsSync(candidate));
  if (!schemaPath) {
    throw new Error(`Unable to locate database schema.sql. Checked: ${schemaPathCandidates.join(", ")}`);
  }
  return schemaPath;
}

function ensureLocalCloudTables(db: DatabaseSync): void {
  db.exec(`
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
  `);
  addColumnIfMissing(db, "local_cloud_identity", "user_refresh_token", "TEXT");
  addColumnIfMissing(db, "local_cloud_identity", "device_refresh_token", "TEXT");
}

function ensureChatTables(db: DatabaseSync): void {
  addColumnIfMissing(db, "conversations", "org_id", "TEXT");
  addColumnIfMissing(db, "conversations", "local_user_id", "TEXT");
  addColumnIfMissing(db, "conversations", "local_agent_instance_id", "TEXT");
  addColumnIfMissing(db, "conversations", "peer_user_id", "TEXT");
  addColumnIfMissing(db, "conversations", "peer_agent_instance_id", "TEXT");
  addColumnIfMissing(db, "conversations", "title", "TEXT NOT NULL DEFAULT 'Conversation'");
  addColumnIfMissing(db, "conversations", "last_message_at", "TEXT");
  addColumnIfMissing(db, "conversations", "last_read_message_id", "TEXT");
  addColumnIfMissing(db, "conversations", "unread_count", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "conversations", "mention_count", "INTEGER NOT NULL DEFAULT 0");
  db.exec(`
    UPDATE conversations SET mode = 'local' WHERE mode = 'single-device';

    CREATE TABLE IF NOT EXISTS conversation_participants (
      conversation_id TEXT NOT NULL,
      user_id TEXT,
      agent_instance_id TEXT,
      role TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (conversation_id, role, agent_instance_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
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
  `);
}

function ensureApprovalTransferTables(db: DatabaseSync): void {
  db.exec(`
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
  `);
}

function addColumnIfMissing(db: DatabaseSync, table: string, column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function ensureAnpTables(db: DatabaseSync): void {
  addColumnIfMissing(db, "peer_sessions", "peer_agent_instance_id", "TEXT NOT NULL DEFAULT ''");
  db.exec("UPDATE peer_sessions SET peer_agent_instance_id = peer_agent_id WHERE peer_agent_instance_id = ''");
}

function ensurePhaseFiveTables(db: DatabaseSync): void {
  db.exec(`
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
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      entity_type TEXT,
      entity_id TEXT,
      delivered INTEGER NOT NULL DEFAULT 0,
      bridge_available INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `);
}

function ensureVoiceTables(db: DatabaseSync): void {
  db.exec(`
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
      stt_confidence REAL,
      parsed_intent TEXT NOT NULL,
      parsed_json TEXT NOT NULL DEFAULT '{}',
      preview_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL,
      conversation_id TEXT,
      relay_task_id TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      confirmed_at TEXT,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_voice_commands_profile_created
      ON voice_commands(profile_id, created_at DESC);
  `);
}
