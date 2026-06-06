import { getDb } from "../../db/connection.js";
import type { SessionKey } from "./AnpCrypto.js";

export interface AnpSessionRecord {
  sessionId: string;
  sourceDid: string;
  destinationDid: string;
  sourcePublicKeyHex: string;
  destinationPublicKeyHex: string;
  sharedSecretHex: string; // derived shared secret, hex
  secretKeyId: string;
  expiresAt: number;
  status: "active" | "expired" | "revoked";
}

interface AnpSessionRow {
  session_id: string;
  source_did: string;
  destination_did: string;
  source_public_key_hex: string;
  destination_public_key_hex: string;
  shared_secret_hex: string;
  secret_key_id: string;
  expires_at: number;
  status: string;
}

function ensureAnpSessionsTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS anp_sessions (
      session_id TEXT PRIMARY KEY,
      source_did TEXT NOT NULL,
      destination_did TEXT NOT NULL,
      source_public_key_hex TEXT NOT NULL,
      destination_public_key_hex TEXT NOT NULL,
      shared_secret_hex TEXT NOT NULL,
      secret_key_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_anp_sessions_status ON anp_sessions(status);
    CREATE INDEX IF NOT EXISTS idx_anp_sessions_expires ON anp_sessions(expires_at);
  `);
}

export function upsertAnpSession(record: AnpSessionRecord): void {
  ensureAnpSessionsTable();
  const db = getDb();
  db.prepare(`
    INSERT INTO anp_sessions (session_id, source_did, destination_did, source_public_key_hex, destination_public_key_hex, shared_secret_hex, secret_key_id, expires_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      destination_public_key_hex=excluded.destination_public_key_hex,
      shared_secret_hex=excluded.shared_secret_hex,
      secret_key_id=excluded.secret_key_id,
      expires_at=excluded.expires_at,
      status=excluded.status
  `).run(
    record.sessionId, record.sourceDid, record.destinationDid,
    record.sourcePublicKeyHex, record.destinationPublicKeyHex,
    record.sharedSecretHex, record.secretKeyId, record.expiresAt, record.status
  );
}

export function getAnpSession(sessionId: string): AnpSessionRecord | null {
  ensureAnpSessionsTable();
  const row = getDb().prepare("SELECT * FROM anp_sessions WHERE session_id = ?").get(sessionId) as AnpSessionRow | undefined;
  if (!row) return null;
  return {
    sessionId: row.session_id,
    sourceDid: row.source_did,
    destinationDid: row.destination_did,
    sourcePublicKeyHex: row.source_public_key_hex,
    destinationPublicKeyHex: row.destination_public_key_hex,
    sharedSecretHex: row.shared_secret_hex,
    secretKeyId: row.secret_key_id,
    expiresAt: row.expires_at,
    status: row.status as AnpSessionRecord["status"],
  };
}

export function listAnpSessions(): AnpSessionRecord[] {
  ensureAnpSessionsTable();
  return (getDb().prepare("SELECT * FROM anp_sessions ORDER BY created_at DESC").all() as unknown as AnpSessionRow[]).map((row) => ({
    sessionId: row.session_id,
    sourceDid: row.source_did,
    destinationDid: row.destination_did,
    sourcePublicKeyHex: row.source_public_key_hex,
    destinationPublicKeyHex: row.destination_public_key_hex,
    sharedSecretHex: row.shared_secret_hex,
    secretKeyId: row.secret_key_id,
    expiresAt: row.expires_at,
    status: row.status as AnpSessionRecord["status"],
  }));
}

export function deriveSessionKeyFromSharedSecret(sharedSecretHex: string, sourceRandom: string, destinationRandom: string, sessionId: string): SessionKey {
  // Import lazily to avoid circular dep at module load
  const { deriveSessionKey } = require("./AnpCrypto.js") as typeof import("./AnpCrypto.js");
  return deriveSessionKey(Buffer.from(sharedSecretHex, "hex"), Buffer.from(sourceRandom + destinationRandom, "hex"), `anp:${sessionId}`);
}
