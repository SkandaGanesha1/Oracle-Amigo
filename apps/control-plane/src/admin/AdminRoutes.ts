import type { FastifyInstance } from "fastify";
import { requireAdmin } from "./../auth/AuthMiddleware.js";
import { getControlPlaneInfo, getFullSnapshot, listAllUsersAcrossOrgs } from "./AdminService.js";
import { getDb } from "./../db/connection.js";
import { recomputeStalePresence } from "./../presence/PresenceService.js";
import { appendAuditEvent } from "../audit/CloudAuditService.js";

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

  app.get("/v1/admin/approvals", { preHandler: requireAdmin() }, async () => {
    const db = getDb();
    const rows = db.prepare(`
      SELECT rt.id AS relay_task_id, rt.org_id, rt.from_agent_instance_id, rt.to_agent_instance_id,
             rt.a2a_task_id, rt.type, rt.status AS task_status, rt.created_at, rt.updated_at,
             rt.completed_at
      FROM relay_tasks rt
      WHERE rt.type LIKE '%approval%' OR rt.payload_json LIKE '%approval%'
      ORDER BY rt.created_at DESC LIMIT 500
    `).all();
    return { approvals: rows };
  });

  app.post("/v1/admin/devices/:device_id/revoke", { preHandler: requireAdmin() }, async (req, reply) => {
    const { device_id } = req.params as { device_id: string };
    const db = getDb();
    const row = db.prepare("SELECT org_id, user_id, status FROM devices WHERE id = ?").get(device_id) as
      { org_id: string; user_id: string; status: string } | undefined;
    if (!row) {
      reply.code(404).send({ error: "NOT_FOUND", message: "Device not found" });
      return;
    }
    const now = new Date().toISOString();
    db.prepare("BEGIN").run();
    try {
      db.prepare("UPDATE devices SET status = 'revoked', last_seen_at = ? WHERE id = ?").run(now, device_id);
      db.prepare("UPDATE device_tokens SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL").run(now, device_id);
      db.prepare("UPDATE agent_instances SET status = 'revoked', last_seen_at = ? WHERE device_id = ?").run(now, device_id);
      db.prepare("UPDATE presence SET status = 'revoked', last_heartbeat_at = ? WHERE device_id = ?").run(now, device_id);
      appendAuditEvent({
        orgId: row.org_id,
        actorUserId: req.adminContext?.adminUserId ?? null,
        eventType: "ADMIN_DEVICE_REVOKED",
        details: { device_id, previous_status: row.status }
      }, db);
    } catch (err) {
      db.prepare("ROLLBACK").run();
      throw err;
    }
    db.prepare("COMMIT").run();
    return { ok: true, device_id, status: "revoked" };
  });

  app.post("/v1/admin/users/:user_id/disable", { preHandler: requireAdmin() }, async (req, reply) => {
    const { user_id } = req.params as { user_id: string };
    const db = getDb();
    const row = db.prepare("SELECT org_id, status FROM users WHERE id = ?").get(user_id) as
      { org_id: string; status: string } | undefined;
    if (!row) {
      reply.code(404).send({ error: "NOT_FOUND", message: "User not found" });
      return;
    }
    const now = new Date().toISOString();
    db.prepare("BEGIN").run();
    try {
      db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(user_id);
      db.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(now, user_id);
      db.prepare("UPDATE device_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(now, user_id);
      db.prepare("UPDATE devices SET status = 'disabled', last_seen_at = ? WHERE user_id = ? AND status = 'active'").run(now, user_id);
      db.prepare("UPDATE agents SET status = 'disabled' WHERE owner_user_id = ?").run(user_id);
      db.prepare("UPDATE agent_instances SET status = 'disabled', last_seen_at = ? WHERE user_id = ? AND status = 'active'").run(now, user_id);
      db.prepare("UPDATE presence SET status = 'revoked', last_heartbeat_at = ? WHERE user_id = ?").run(now, user_id);
      appendAuditEvent({
        orgId: row.org_id,
        actorUserId: req.adminContext?.adminUserId ?? null,
        eventType: "ADMIN_USER_DISABLED",
        details: { user_id, previous_status: row.status }
      }, db);
    } catch (err) {
      db.prepare("ROLLBACK").run();
      throw err;
    }
    db.prepare("COMMIT").run();
    return { ok: true, user_id, status: "disabled" };
  });

  app.post("/v1/admin/agent-instances/:agent_instance_id/disable", { preHandler: requireAdmin() }, async (req, reply) => {
    const { agent_instance_id } = req.params as { agent_instance_id: string };
    const db = getDb();
    const row = db.prepare("SELECT org_id, device_id, status FROM agent_instances WHERE id = ?").get(agent_instance_id) as
      { org_id: string; device_id: string; status: string } | undefined;
    if (!row) {
      reply.code(404).send({ error: "NOT_FOUND", message: "Agent instance not found" });
      return;
    }
    const now = new Date().toISOString();
    db.prepare("BEGIN").run();
    try {
      db.prepare("UPDATE agent_instances SET status = 'disabled', last_seen_at = ? WHERE id = ?").run(now, agent_instance_id);
      db.prepare("UPDATE presence SET status = 'revoked', last_heartbeat_at = ? WHERE agent_instance_id = ?").run(now, agent_instance_id);
      appendAuditEvent({
        orgId: row.org_id,
        actorUserId: req.adminContext?.adminUserId ?? null,
        actorAgentInstanceId: agent_instance_id,
        eventType: "ADMIN_AGENT_INSTANCE_DISABLED",
        details: { agent_instance_id, device_id: row.device_id, previous_status: row.status }
      }, db);
    } catch (err) {
      db.prepare("ROLLBACK").run();
      throw err;
    }
    db.prepare("COMMIT").run();
    return { ok: true, agent_instance_id, status: "disabled" };
  });

  app.get("/v1/admin/orgs/:org_id/snapshot", { preHandler: requireAdmin() }, async (req, reply) => {
    const { org_id } = req.params as { org_id: string };
    const snapshot = getFullSnapshot(org_id);
    return snapshot;
  });
}
