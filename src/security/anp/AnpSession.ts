import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getDb } from "../../db/connection.js";
import type { SessionKey } from "./AnpCrypto.js";

export interface AnpSessionRecord {
  sessionId: string;
  sourceDid: string;
  destinationDid: string;
  sourcePublicKeyHex: string;
  destinationPublicKeyHex: string;
  sharedSecretHex: string;
  secretKeyId: string;
  expiresAt: number;
  status: "active" | "expired" | "revoked";
}

export type AnpSessionSummary = Omit<AnpSessionRecord, "sharedSecretHex">;

interface AnpSessionRow {
  session_id: string;
  source_did: string;
  destination_did: string;
  source_public_key_hex: string;
  destination_public_key_hex: string;
  shared_secret_hex?: string;
  encrypted_shared_secret?: string;
  secret_key_id: string;
  expires_at: number;
  status: string;
}

const processLocalAnpKek = randomBytes(32);

function ensureAnpSessionsTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS anp_sessions (
      session_id TEXT PRIMARY KEY,
      source_did TEXT NOT NULL,
      destination_did TEXT NOT NULL,
      source_public_key_hex TEXT NOT NULL,
      destination_public_key_hex TEXT NOT NULL,
      encrypted_shared_secret TEXT NOT NULL,
      shared_secret_hex TEXT,
      secret_key_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_anp_sessions_status ON anp_sessions(status);
    CREATE INDEX IF NOT EXISTS idx_anp_sessions_expires ON anp_sessions(expires_at);
  `);
  const columns = (db.prepare("PRAGMA table_info(anp_sessions)").all() as Array<{ name: string }>).map((column) => column.name);
  if (!columns.includes("encrypted_shared_secret")) {
    db.prepare("ALTER TABLE anp_sessions ADD COLUMN encrypted_shared_secret TEXT").run();
  }
  if (!columns.includes("shared_secret_hex")) {
    db.prepare("ALTER TABLE anp_sessions ADD COLUMN shared_secret_hex TEXT").run();
  }
  migrateLegacyPlaintextSecrets();
}

export function upsertAnpSession(record: AnpSessionRecord): void {
  ensureAnpSessionsTable();
  const db = getDb();
  db.prepare(`
    INSERT INTO anp_sessions (session_id, source_did, destination_did, source_public_key_hex, destination_public_key_hex, encrypted_shared_secret, shared_secret_hex, secret_key_id, expires_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      destination_public_key_hex=excluded.destination_public_key_hex,
      encrypted_shared_secret=excluded.encrypted_shared_secret,
      shared_secret_hex=excluded.shared_secret_hex,
      secret_key_id=excluded.secret_key_id,
      expires_at=excluded.expires_at,
      status=excluded.status
  `).run(
    record.sessionId, record.sourceDid, record.destinationDid,
    record.sourcePublicKeyHex, record.destinationPublicKeyHex,
    wrapSharedSecret(record.sessionId, record.sharedSecretHex), "", record.secretKeyId, record.expiresAt, record.status
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
    sharedSecretHex: unwrapSharedSecret(row.session_id, row.encrypted_shared_secret, row.shared_secret_hex),
    secretKeyId: row.secret_key_id,
    expiresAt: row.expires_at,
    status: row.status as AnpSessionRecord["status"],
  };
}

export function listAnpSessions(): AnpSessionSummary[] {
  ensureAnpSessionsTable();
  return (getDb().prepare("SELECT * FROM anp_sessions ORDER BY created_at DESC").all() as unknown as AnpSessionRow[]).map((row) => ({
    sessionId: row.session_id,
    sourceDid: row.source_did,
    destinationDid: row.destination_did,
    sourcePublicKeyHex: row.source_public_key_hex,
    destinationPublicKeyHex: row.destination_public_key_hex,
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

function migrateLegacyPlaintextSecrets(): void {
  const db = getDb();
  const rows = db.prepare(`
    SELECT session_id, shared_secret_hex
    FROM anp_sessions
    WHERE COALESCE(encrypted_shared_secret, '') = '' AND COALESCE(shared_secret_hex, '') != ''
  `).all() as Array<{ session_id: string; shared_secret_hex: string }>;
  const update = db.prepare("UPDATE anp_sessions SET encrypted_shared_secret = ?, shared_secret_hex = '' WHERE session_id = ?");
  for (const row of rows) {
    update.run(wrapSharedSecret(row.session_id, row.shared_secret_hex), row.session_id);
  }
}

function wrapSharedSecret(sessionId: string, sharedSecretHex: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", anpSessionKek(), iv);
  cipher.setAAD(Buffer.from(sessionId, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(sharedSecretHex, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

function unwrapSharedSecret(sessionId: string, encrypted: string | undefined, legacyPlaintext: string | undefined): string {
  if (!encrypted) {
    if (legacyPlaintext) return legacyPlaintext;
    throw new Error("ANP session secret is missing");
  }
  const [ivEncoded, tagEncoded, ciphertextEncoded] = encrypted.split(".");
  if (!ivEncoded || !tagEncoded || !ciphertextEncoded) throw new Error("ANP session secret is malformed");
  const decipher = createDecipheriv("aes-256-gcm", anpSessionKek(), Buffer.from(ivEncoded, "base64url"));
  decipher.setAAD(Buffer.from(sessionId, "utf8"));
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function anpSessionKek(): Buffer {
  const configured = process.env.ANP_SESSION_KEK ?? process.env.LOCAL_AGENT_API_TOKEN;
  if (!configured) return processLocalAnpKek;
  return createHash("sha256").update("oracle-amigo:anp-session-kek:v1").update(configured).digest();
}
