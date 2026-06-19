import { getControlPlaneStore } from "../db/connection.js";
import type { ControlPlaneStore } from "../db/ControlPlaneStore.js";
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

const ADMIN_TRANSFER_COLUMNS = `
  id, org_id, relay_task_id, from_agent_instance_id, to_agent_instance_id,
  file_name, file_size, sha256, encryption_key_id, encryption_algo, status,
  expires_at, created_at, completed_at
`;

export async function getFullSnapshot(
  orgId: OrgId,
  opts: { store?: ControlPlaneStore; limit?: number } = {}
): Promise<AdminSnapshot> {
  const db = opts.store ?? getControlPlaneStore();
  const limit = opts.limit ?? 200;
  await recomputeStalePresence(db);
  const orgRow = await db.one("SELECT * FROM organizations WHERE id = $1", [orgId]);
  return {
    organizations: orgRow ? [orgRow as Record<string, unknown>] : [],
    users: await db.query("SELECT * FROM users WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2", [orgId, limit]),
    devices: await db.query("SELECT * FROM devices WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2", [orgId, limit]),
    agents: await db.query("SELECT * FROM agents WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2", [orgId, limit]),
    agent_instances: await db.query("SELECT * FROM agent_instances WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2", [orgId, limit]),
    presence: await listPresence(orgId, { store: db }),
    relay_tasks: await db.query("SELECT * FROM relay_tasks WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2", [orgId, limit]),
    file_transfers: await db.query(`SELECT ${ADMIN_TRANSFER_COLUMNS} FROM file_transfers WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2`, [orgId, limit]),
    audit_events: await listAuditEvents(orgId, limit, db) as unknown as Array<Record<string, unknown>>
  };
}

export async function listAllUsersAcrossOrgs(store: ControlPlaneStore = getControlPlaneStore(), limit = 500): Promise<Array<Record<string, unknown>>> {
  return store.query(`
    SELECT u.*, o.slug AS org_slug
    FROM users u
    JOIN organizations o ON o.id = u.org_id
    ORDER BY u.created_at DESC
    LIMIT $1
  `, [limit]);
}

export function getControlPlaneInfo(): { env: string; version: string; uptimeSeconds: number } {
  const cfg = loadConfig();
  return {
    env: cfg.CONTROL_PLANE_ENV,
    version: "0.1.0",
    uptimeSeconds: Math.floor(process.uptime())
  };
}
