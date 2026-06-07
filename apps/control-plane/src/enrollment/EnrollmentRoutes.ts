import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { requireUserAuth, requireDeviceAuth } from "./../auth/AuthMiddleware.js";
import { enroll } from "./EnrollmentService.js";
import { getDb } from "./../db/connection.js";
import type { Device, AgentInstance, Agent } from "./../types/cloud.js";

const EnrollSchema = z.object({
  device: z.object({
    device_name: z.string().min(1).max(120),
    os: z.string().max(40).optional(),
    os_version: z.string().max(80).optional(),
    public_key: z.string().min(32).max(8192),
    did: z.string().max(500).optional()
  }),
  agent: z.object({
    display_name: z.string().min(1).max(120),
    version: z.string().max(40).optional(),
    capabilities: z.array(z.string().min(1).max(120)).max(50).optional(),
    agent_card: z.record(z.unknown())
  })
});

export async function registerEnrollmentRoutes(app: FastifyInstance, publicBaseUrl: string): Promise<void> {
  app.post("/v1/enrollment/complete", { preHandler: requireUserAuth() }, async (req, reply) => {
    if (!req.authContext) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    try {
      const body = EnrollSchema.parse(req.body);
      const result = await enroll(req.authContext, body, { publicBaseUrl });
      reply.send(result);
    } catch (err) {
      if (err instanceof ZodError) {
        reply.code(400).send({ error: "VALIDATION_ERROR", message: "Invalid request", issues: err.issues });
        return;
      }
      reply.code(400).send({ error: "ENROLLMENT_FAILED", message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/v1/devices/me", { preHandler: requireUserAuth() }, async (req, reply) => {
    if (!req.authContext) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM devices WHERE org_id = ? AND user_id = ? ORDER BY created_at DESC
    `).all(req.authContext.orgId, req.authContext.userId) as Array<Record<string, unknown>>;
    const devices: Device[] = rows.map((r) => ({
      id: String(r.id),
      orgId: String(r.org_id),
      userId: String(r.user_id),
      deviceName: String(r.device_name),
      os: r.os ? String(r.os) : null,
      osVersion: r.os_version ? String(r.os_version) : null,
      publicKey: String(r.public_key),
      publicKeyFingerprint: String(r.public_key_fingerprint),
      did: r.did ? String(r.did) : null,
      status: String(r.status) as Device["status"],
      createdAt: String(r.created_at),
      lastSeenAt: r.last_seen_at ? String(r.last_seen_at) : null
    }));
    reply.send({ devices });
  });

  app.get("/v1/agents/me", { preHandler: requireUserAuth() }, async (req, reply) => {
    if (!req.authContext) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    const db = getDb();
    const agentRows = db.prepare(`
      SELECT * FROM agents WHERE org_id = ? AND owner_user_id = ? ORDER BY created_at ASC
    `).all(req.authContext.orgId, req.authContext.userId) as Array<Record<string, unknown>>;
    const agents: Agent[] = agentRows.map((r) => ({
      id: String(r.id),
      orgId: String(r.org_id),
      ownerUserId: String(r.owner_user_id),
      displayName: String(r.display_name),
      status: String(r.status) as Agent["status"],
      createdAt: String(r.created_at)
    }));
    const instanceRows = db.prepare(`
      SELECT * FROM agent_instances WHERE org_id = ? AND user_id = ? ORDER BY created_at ASC
    `).all(req.authContext.orgId, req.authContext.userId) as Array<Record<string, unknown>>;
    const instances: AgentInstance[] = instanceRows.map((r) => ({
      id: String(r.id),
      orgId: String(r.org_id),
      agentId: String(r.agent_id),
      deviceId: String(r.device_id),
      userId: String(r.user_id),
      agentCardJson: String(r.agent_card_json),
      agentCardHash: String(r.agent_card_hash),
      relayInboxId: String(r.relay_inbox_id),
      version: r.version ? String(r.version) : null,
      status: String(r.status) as AgentInstance["status"],
      createdAt: String(r.created_at),
      lastSeenAt: r.last_seen_at ? String(r.last_seen_at) : null
    }));
    reply.send({ agents, instances });
  });

  app.get("/v1/agents/:agent_instance_id/card", { preHandler: requireDeviceAuth() }, async (req, reply) => {
    if (!req.deviceContext) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    const { agent_instance_id } = req.params as { agent_instance_id: string };
    const db = getDb();
    const row = db.prepare(`
      SELECT * FROM agent_instances WHERE org_id = ? AND id = ?
    `).get(req.deviceContext.orgId, agent_instance_id) as Record<string, unknown> | undefined;
    if (!row) {
      reply.code(404).send({ error: "NOT_FOUND", message: "Agent instance not found" });
      return;
    }
    try {
      const card = JSON.parse(String(row.agent_card_json));
      reply.send(card);
    } catch {
      reply.code(500).send({ error: "INVALID_CARD", message: "Stored agent card is not valid JSON" });
    }
  });
}
