import type { FastifyInstance } from "fastify";
import { requireAdmin } from "./../auth/AuthMiddleware.js";
import { getControlPlaneInfo, getFullSnapshot, listAllUsersAcrossOrgs } from "./AdminService.js";
import { getDb } from "./../db/connection.js";
import { recomputeStalePresence } from "./../presence/PresenceService.js";

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/admin/info", { preHandler: requireAdmin() }, async () => getControlPlaneInfo());

  app.get("/v1/admin/users", { preHandler: requireAdmin() }, async () => {
    const users = listAllUsersAcrossOrgs();
    return { users };
  });

  app.get("/v1/admin/devices", { preHandler: requireAdmin() }, async () => {
    const db = getDb();
    const rows = db.prepare(`
      SELECT d.*, u.email AS owner_email, o.slug AS org_slug
      FROM devices d
      JOIN users u ON u.id = d.user_id
      JOIN organizations o ON o.id = d.org_id
      ORDER BY d.created_at DESC
    `).all();
    return { devices: rows };
  });

  app.get("/v1/admin/agent-instances", { preHandler: requireAdmin() }, async () => {
    const db = getDb();
    const rows = db.prepare(`
      SELECT ai.*, a.display_name AS agent_display_name, d.device_name, u.email AS owner_email
      FROM agent_instances ai
      JOIN agents a ON a.id = ai.agent_id
      JOIN devices d ON d.id = ai.device_id
      JOIN users u ON u.id = ai.user_id
      ORDER BY ai.created_at DESC
    `).all();
    return { instances: rows };
  });

  app.get("/v1/admin/presence", { preHandler: requireAdmin() }, async () => {
    recomputeStalePresence();
    const db = getDb();
    const rows = db.prepare(`
      SELECT p.*, d.device_name, u.email AS owner_email
      FROM presence p
      JOIN devices d ON d.id = p.device_id
      JOIN users u ON u.id = p.user_id
      ORDER BY p.last_heartbeat_at DESC
    `).all();
    return { presence: rows };
  });

  app.get("/v1/admin/tasks", { preHandler: requireAdmin() }, async () => {
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM relay_tasks ORDER BY created_at DESC LIMIT 500
    `).all();
    return { tasks: rows };
  });

  app.get("/v1/admin/transfers", { preHandler: requireAdmin() }, async () => {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, org_id, from_agent_instance_id, to_agent_instance_id, file_name, file_size, sha256, status, expires_at, created_at, completed_at
      FROM file_transfers
      ORDER BY created_at DESC LIMIT 500
    `).all();
    return { transfers: rows };
  });

  app.get("/v1/admin/audit", { preHandler: requireAdmin() }, async () => {
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 500
    `).all();
    return { events: rows };
  });

  app.get("/v1/admin/orgs/:org_id/snapshot", { preHandler: requireAdmin() }, async (req, reply) => {
    const { org_id } = req.params as { org_id: string };
    const snapshot = getFullSnapshot(org_id);
    return snapshot;
  });
}
