import type { Database as DB } from "better-sqlite3";
import { getDb } from "../db/connection.js";
import { listAuditEvents } from "../audit/CloudAuditService.js";
import { recomputeStalePresence, listPresence } from "../presence/PresenceService.js";
import { loadConfig } from "../config.js";
import type { OrgId } from "../types/cloud.js";

export interface AdminSnapshot {
  organizations: Array<Record<string, unknown>>;
  users: Array<Record<string, unknown>>;
  devices: Array<Record<string, unknown>>;
  agents: Array<Record<string, unknown>>;
  agent_instances: Array<Record<string, unknown>>;
  presence: Array<Record<string, unknown>>;
  relay_tasks: Array<Record<string, unknown>>;
  file_transfers: Array<Record<string, unknown>>;
  audit_events: Array<Record<string, unknown>>;
}

export function getFullSnapshot(
  orgId: OrgId,
  opts: { db?: DB; limit?: number } = {}
): AdminSnapshot {
  const db = opts.db ?? getDb();
  const limit = opts.limit ?? 200;
  recomputeStalePresence(db);
  const orgRow = db.prepare("SELECT * FROM organizations WHERE id = ?").get(orgId);
  return {
    organizations: orgRow ? [orgRow as Record<string, unknown>] : [],
    users: db.prepare("SELECT * FROM users WHERE org_id = ? ORDER BY created_at DESC LIMIT ?").all(orgId, limit) as Array<Record<string, unknown>>,
    devices: db.prepare("SELECT * FROM devices WHERE org_id = ? ORDER BY created_at DESC LIMIT ?").all(orgId, limit) as Array<Record<string, unknown>>,
    agents: db.prepare("SELECT * FROM agents WHERE org_id = ? ORDER BY created_at DESC LIMIT ?").all(orgId, limit) as Array<Record<string, unknown>>,
    agent_instances: db.prepare("SELECT * FROM agent_instances WHERE org_id = ? ORDER BY created_at DESC LIMIT ?").all(orgId, limit) as Array<Record<string, unknown>>,
    presence: listPresence(orgId, { db }),
    relay_tasks: db.prepare("SELECT * FROM relay_tasks WHERE org_id = ? ORDER BY created_at DESC LIMIT ?").all(orgId, limit) as Array<Record<string, unknown>>,
    file_transfers: db.prepare("SELECT * FROM file_transfers WHERE org_id = ? ORDER BY created_at DESC LIMIT ?").all(orgId, limit) as Array<Record<string, unknown>>,
    audit_events: listAuditEvents(orgId, limit, db) as unknown as Array<Record<string, unknown>>
  };
}

export function listAllUsersAcrossOrgs(db: DB = getDb()): Array<Record<string, unknown>> {
  return db.prepare(`
    SELECT u.*, o.slug AS org_slug
    FROM users u
    JOIN organizations o ON o.id = u.org_id
    ORDER BY u.created_at DESC
  `).all() as Array<Record<string, unknown>>;
}

export function getControlPlaneInfo(): { env: string; version: string; uptimeSeconds: number } {
  const cfg = loadConfig();
  return {
    env: cfg.CONTROL_PLANE_ENV,
    version: "0.1.0",
    uptimeSeconds: Math.floor(process.uptime())
  };
}
