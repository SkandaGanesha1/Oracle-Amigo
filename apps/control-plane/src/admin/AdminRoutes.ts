import type { FastifyInstance } from "fastify";
import { requireAdmin } from "./../auth/AuthMiddleware.js";
import { getControlPlaneInfo, getFullSnapshot, listAllUsersAcrossOrgs } from "./AdminService.js";
import { getControlPlaneStore } from "./../db/connection.js";
import { recomputeStalePresence } from "./../presence/PresenceService.js";
import { appendAuditEvent } from "../audit/CloudAuditService.js";

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/admin/info", { preHandler: requireAdmin() }, async () => getControlPlaneInfo());

  app.get("/v1/admin/users", { preHandler: requireAdmin() }, async () => {
    const users = await listAllUsersAcrossOrgs();
    return { users };
  });

  app.get("/v1/admin/devices", { preHandler: requireAdmin() }, async () => {
    const rows = await getControlPlaneStore().query(`
      SELECT d.*, u.email AS owner_email, o.slug AS org_slug
      FROM devices d
      JOIN users u ON u.id = d.user_id
      JOIN organizations o ON o.id = d.org_id
      ORDER BY d.created_at DESC
      LIMIT 500
    `);
    return { devices: rows };
  });

  app.get("/v1/admin/agent-instances", { preHandler: requireAdmin() }, async () => {
    const rows = await getControlPlaneStore().query(`
      SELECT ai.*, a.display_name AS agent_display_name, d.device_name, u.email AS owner_email
      FROM agent_instances ai
      JOIN agents a ON a.id = ai.agent_id
      JOIN devices d ON d.id = ai.device_id
      JOIN users u ON u.id = ai.user_id
      ORDER BY ai.created_at DESC
      LIMIT 500
    `);
    return { instances: rows };
  });

  app.get("/v1/admin/presence", { preHandler: requireAdmin() }, async () => {
    await recomputeStalePresence();
    const rows = await getControlPlaneStore().query(`
      SELECT p.*, d.device_name, u.email AS owner_email
      FROM presence p
      JOIN devices d ON d.id = p.device_id
      JOIN users u ON u.id = p.user_id
      ORDER BY p.last_heartbeat_at DESC
      LIMIT 500
    `);
    return { presence: rows };
  });

  app.get("/v1/admin/tasks", { preHandler: requireAdmin() }, async () => {
    const rows = await getControlPlaneStore().query(`
      SELECT * FROM relay_tasks ORDER BY created_at DESC LIMIT 500
    `);
    return { tasks: rows };
  });

  app.get("/v1/admin/transfers", { preHandler: requireAdmin() }, async () => {
    const rows = await getControlPlaneStore().query(`
      SELECT id, org_id, from_agent_instance_id, to_agent_instance_id, file_name, file_size, sha256, status, expires_at, created_at, completed_at
      FROM file_transfers
      ORDER BY created_at DESC LIMIT 500
    `);
    return { transfers: rows };
  });

  app.get("/v1/admin/audit", { preHandler: requireAdmin() }, async () => {
    const rows = await getControlPlaneStore().query(`
      SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 500
    `);
    return { events: rows };
  });

  app.get("/v1/admin/approvals", { preHandler: requireAdmin() }, async () => {
    const rows = await getControlPlaneStore().query(`
      SELECT rt.id AS relay_task_id, rt.org_id, rt.from_agent_instance_id, rt.to_agent_instance_id,
             rt.a2a_task_id, rt.type, rt.status AS task_status, rt.created_at, rt.updated_at,
             rt.completed_at
      FROM relay_tasks rt
      WHERE rt.type LIKE '%approval%' OR rt.payload_json LIKE '%approval%'
      ORDER BY rt.created_at DESC LIMIT 500
    `);
    return { approvals: rows };
  });

  app.post("/v1/admin/devices/:device_id/revoke", { preHandler: requireAdmin() }, async (req, reply) => {
    const { device_id } = req.params as { device_id: string };
    const db = getControlPlaneStore();
    const row = await db.one<{ org_id: string; user_id: string; status: string }>(
      "SELECT org_id, user_id, status FROM devices WHERE id = $1",
      [device_id]
    );
    if (!row) {
      reply.code(404).send({ error: "NOT_FOUND", message: "Device not found" });
      return;
    }
    const now = new Date().toISOString();
    await db.transaction(async (tx) => {
      await tx.execute("UPDATE devices SET status = 'revoked', last_seen_at = $1 WHERE id = $2", [now, device_id]);
      await tx.execute("UPDATE device_tokens SET revoked_at = $1 WHERE device_id = $2 AND revoked_at IS NULL", [now, device_id]);
      await tx.execute("UPDATE agent_instances SET status = 'revoked', last_seen_at = $1 WHERE device_id = $2", [now, device_id]);
      await tx.execute("UPDATE presence SET status = 'revoked', last_heartbeat_at = $1 WHERE device_id = $2", [now, device_id]);
      await appendAuditEvent({
        orgId: row.org_id,
        actorUserId: req.adminContext?.adminUserId ?? null,
        eventType: "ADMIN_DEVICE_REVOKED",
        details: { device_id, previous_status: row.status }
      }, tx);
    });
    return { ok: true, device_id, status: "revoked" };
  });

  app.post("/v1/admin/users/:user_id/disable", { preHandler: requireAdmin() }, async (req, reply) => {
    const { user_id } = req.params as { user_id: string };
    const db = getControlPlaneStore();
    const row = await db.one<{ org_id: string; status: string }>("SELECT org_id, status FROM users WHERE id = $1", [user_id]);
    if (!row) {
      reply.code(404).send({ error: "NOT_FOUND", message: "User not found" });
      return;
    }
    const now = new Date().toISOString();
    await db.transaction(async (tx) => {
      await tx.execute("UPDATE users SET status = 'disabled' WHERE id = $1", [user_id]);
      await tx.execute("UPDATE refresh_tokens SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL", [now, user_id]);
      await tx.execute("UPDATE device_tokens SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL", [now, user_id]);
      await tx.execute("UPDATE devices SET status = 'disabled', last_seen_at = $1 WHERE user_id = $2 AND status = 'active'", [now, user_id]);
      await tx.execute("UPDATE agents SET status = 'disabled' WHERE owner_user_id = $1", [user_id]);
      await tx.execute("UPDATE agent_instances SET status = 'disabled', last_seen_at = $1 WHERE user_id = $2 AND status = 'active'", [now, user_id]);
      await tx.execute("UPDATE presence SET status = 'revoked', last_heartbeat_at = $1 WHERE user_id = $2", [now, user_id]);
      await appendAuditEvent({
        orgId: row.org_id,
        actorUserId: req.adminContext?.adminUserId ?? null,
        eventType: "ADMIN_USER_DISABLED",
        details: { user_id, previous_status: row.status }
      }, tx);
    });
    return { ok: true, user_id, status: "disabled" };
  });

  app.post("/v1/admin/agent-instances/:agent_instance_id/disable", { preHandler: requireAdmin() }, async (req, reply) => {
    const { agent_instance_id } = req.params as { agent_instance_id: string };
    const db = getControlPlaneStore();
    const row = await db.one<{ org_id: string; device_id: string; status: string }>(
      "SELECT org_id, device_id, status FROM agent_instances WHERE id = $1",
      [agent_instance_id]
    );
    if (!row) {
      reply.code(404).send({ error: "NOT_FOUND", message: "Agent instance not found" });
      return;
    }
    const now = new Date().toISOString();
    await db.transaction(async (tx) => {
      await tx.execute("UPDATE agent_instances SET status = 'disabled', last_seen_at = $1 WHERE id = $2", [now, agent_instance_id]);
      await tx.execute("UPDATE presence SET status = 'revoked', last_heartbeat_at = $1 WHERE agent_instance_id = $2", [now, agent_instance_id]);
      await appendAuditEvent({
        orgId: row.org_id,
        actorUserId: req.adminContext?.adminUserId ?? null,
        actorAgentInstanceId: agent_instance_id,
        eventType: "ADMIN_AGENT_INSTANCE_DISABLED",
        details: { agent_instance_id, device_id: row.device_id, previous_status: row.status }
      }, tx);
    });
    return { ok: true, agent_instance_id, status: "disabled" };
  });

  app.get("/v1/admin/orgs/:org_id/snapshot", { preHandler: requireAdmin() }, async (req, reply) => {
    const { org_id } = req.params as { org_id: string };
    const snapshot = await getFullSnapshot(org_id);
    return snapshot;
  });
}
