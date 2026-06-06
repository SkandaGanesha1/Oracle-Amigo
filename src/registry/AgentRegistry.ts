import { getDb } from "../db/connection.js";

export type TrustLevel = "local" | "loopback" | "trusted" | "discovered" | "blocked";

export interface AgentRegistryRecord {
  id: number;
  did: string;
  name: string;
  description: string;
  agentCardUrl: string;
  anpEndpoint: string;
  supportedProtocols: string[];
  skills: string[];
  trustLevel: TrustLevel;
  firstSeen: string;
  lastSeen: string;
  lastCardHash: string;
  notes: string;
}

interface AgentRegistryRow {
  id: number;
  did: string;
  name: string;
  description: string;
  agent_card_url: string;
  anp_endpoint: string;
  supported_protocols: string;
  skills: string;
  trust_level: string;
  first_seen: string;
  last_seen: string;
  last_card_hash: string;
  notes: string;
}

function ensureAgentRegistryTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_registry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      did TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      agent_card_url TEXT NOT NULL DEFAULT '',
      anp_endpoint TEXT NOT NULL DEFAULT '',
      supported_protocols TEXT NOT NULL DEFAULT '[]',
      skills TEXT NOT NULL DEFAULT '[]',
      trust_level TEXT NOT NULL DEFAULT 'discovered',
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_card_hash TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_agent_registry_did ON agent_registry(did);
    CREATE INDEX IF NOT EXISTS idx_agent_registry_trust ON agent_registry(trust_level);
  `);
}

function rowToRecord(row: AgentRegistryRow): AgentRegistryRecord {
  return {
    id: row.id,
    did: row.did,
    name: row.name,
    description: row.description,
    agentCardUrl: row.agent_card_url,
    anpEndpoint: row.anp_endpoint,
    supportedProtocols: safeParseStringArray(row.supported_protocols),
    skills: safeParseStringArray(row.skills),
    trustLevel: (row.trust_level as TrustLevel) ?? "discovered",
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    lastCardHash: row.last_card_hash,
    notes: row.notes,
  };
}

function safeParseStringArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}

export interface UpsertAgentInput {
  did: string;
  name: string;
  description?: string;
  agentCardUrl?: string;
  anpEndpoint?: string;
  supportedProtocols?: string[];
  skills?: string[];
  trustLevel?: TrustLevel;
  lastCardHash?: string;
  notes?: string;
}

export function upsertAgent(input: UpsertAgentInput): AgentRegistryRecord {
  ensureAgentRegistryTable();
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT id FROM agent_registry WHERE did = ?").get(input.did) as { id: number } | undefined;
  if (existing) {
    db.prepare(`
      UPDATE agent_registry SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        agent_card_url = COALESCE(?, agent_card_url),
        anp_endpoint = COALESCE(?, anp_endpoint),
        supported_protocols = COALESCE(?, supported_protocols),
        skills = COALESCE(?, skills),
        trust_level = COALESCE(?, trust_level),
        last_card_hash = COALESCE(?, last_card_hash),
        notes = COALESCE(?, notes),
        last_seen = ?
      WHERE did = ?
    `).run(
      input.name ?? null,
      input.description ?? null,
      input.agentCardUrl ?? null,
      input.anpEndpoint ?? null,
      input.supportedProtocols ? JSON.stringify(input.supportedProtocols) : null,
      input.skills ? JSON.stringify(input.skills) : null,
      input.trustLevel ?? null,
      input.lastCardHash ?? null,
      input.notes ?? null,
      now,
      input.did
    );
  } else {
    db.prepare(`
      INSERT INTO agent_registry (did, name, description, agent_card_url, anp_endpoint, supported_protocols, skills, trust_level, last_card_hash, notes, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.did,
      input.name,
      input.description ?? "",
      input.agentCardUrl ?? "",
      input.anpEndpoint ?? "",
      input.supportedProtocols ? JSON.stringify(input.supportedProtocols) : "[]",
      input.skills ? JSON.stringify(input.skills) : "[]",
      input.trustLevel ?? "discovered",
      input.lastCardHash ?? "",
      input.notes ?? "",
      now,
      now
    );
  }
  return getAgent(input.did)!;
}

export function getAgent(did: string): AgentRegistryRecord | null {
  ensureAgentRegistryTable();
  const row = getDb().prepare("SELECT * FROM agent_registry WHERE did = ?").get(did) as AgentRegistryRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function listAgents(filter?: { trustLevel?: TrustLevel }): AgentRegistryRecord[] {
  ensureAgentRegistryTable();
  const sql = filter?.trustLevel
    ? "SELECT * FROM agent_registry WHERE trust_level = ? ORDER BY last_seen DESC"
    : "SELECT * FROM agent_registry ORDER BY last_seen DESC";
  const stmt = filter?.trustLevel
    ? getDb().prepare(sql)
    : getDb().prepare(sql);
  const rows = filter?.trustLevel
    ? (stmt.all(filter.trustLevel) as unknown as AgentRegistryRow[])
    : (stmt.all() as unknown as AgentRegistryRow[]);
  return rows.map(rowToRecord);
}

export function deleteAgent(did: string): boolean {
  ensureAgentRegistryTable();
  const result = getDb().prepare("DELETE FROM agent_registry WHERE did = ?").run(did);
  return result.changes > 0;
}

export function setTrustLevel(did: string, trustLevel: TrustLevel): AgentRegistryRecord | null {
  ensureAgentRegistryTable();
  getDb().prepare("UPDATE agent_registry SET trust_level = ?, last_seen = ? WHERE did = ?")
    .run(trustLevel, new Date().toISOString(), did);
  return getAgent(did);
}

export function touchLastSeen(did: string): void {
  ensureAgentRegistryTable();
  getDb().prepare("UPDATE agent_registry SET last_seen = ? WHERE did = ?")
    .run(new Date().toISOString(), did);
}
