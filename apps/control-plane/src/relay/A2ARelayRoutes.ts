import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { requireDeviceAuth, requireUserAuth } from "./../auth/AuthMiddleware.js";
import {
  ackRelay, fetchInbox, getRelayTask, respondRelay, sendRelay
} from "./A2ARelayService.js";
import { loadConfig } from "./../config.js";
import { getControlPlaneStore } from "../db/connection.js";
import { toCloudAgentCard } from "../enrollment/CloudAgentCard.js";

const SendSchema = z.object({
  to_agent_instance_id: z.string().min(1),
  a2a_task_id: z.string().min(1).max(120),
  type: z.string().min(1).max(80),
  payload: z.record(z.unknown()),
  idempotency_key: z.string().min(1).max(200).optional(),
  ttl_seconds: z.number().int().min(60).optional()
});

const RespondSchema = z.object({
  payload: z.record(z.unknown())
});

const InboxQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional()
});

export async function registerA2ARelayRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/relay/a2a/:agent_instance_id", { preHandler: requireDeviceAuth() }, async (req, reply) => {
    if (!req.deviceContext) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    const { agent_instance_id } = req.params as { agent_instance_id: string };
    const row = await getControlPlaneStore().one(`
      SELECT * FROM agent_instances WHERE org_id = $1 AND id = $2
    `, [req.deviceContext.orgId, agent_instance_id]);
    if (!row) {
      reply.code(404).send({ error: "NOT_FOUND", message: "Agent instance not found" });
      return;
    }
    try {
      const cfg = loadConfig();
      const signingKey = cfg.AGENT_CARD_SIGNING_PRIVATE_KEY_PEM
        ? { privateKeyPem: cfg.AGENT_CARD_SIGNING_PRIVATE_KEY_PEM, kid: cfg.AGENT_CARD_SIGNING_KEY_ID }
        : undefined;
      reply.send(toCloudAgentCard(JSON.parse(String(row.agent_card_json)), {
        publicBaseUrl: cfg.CONTROL_PLANE_PUBLIC_URL,
        agentInstanceId: agent_instance_id,
        signingKey
      }));
    } catch {
      reply.code(500).send({ error: "INVALID_CARD", message: "Stored agent card is not valid JSON" });
    }
  });

  app.post("/v1/relay/a2a/send", { preHandler: requireDeviceAuth() }, async (req, reply) => {
    if (!req.deviceContext) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    try {
      const body = SendSchema.parse(req.body);
      const result = await sendRelay({
        orgId: req.deviceContext.orgId,
        fromAgentInstanceId: req.deviceContext.agentInstanceId,
        toAgentInstanceId: body.to_agent_instance_id as never,
        a2aTaskId: body.a2a_task_id,
        type: body.type,
        payload: body.payload,
        idempotencyKey: body.idempotency_key,
        ttlSeconds: body.ttl_seconds
      });
      reply.send(result);
    } catch (err) {
      if (err instanceof ZodError) {
        reply.code(400).send({ error: "VALIDATION_ERROR", issues: err.issues });
        return;
      }
      reply.code(400).send({ error: "RELAY_SEND_FAILED", message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/v1/relay/a2a/inbox", { preHandler: requireDeviceAuth() }, async (req, reply) => {
    if (!req.deviceContext) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    const cfg = loadConfig();
    const parsedQuery = InboxQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      reply.code(400).send({ error: "VALIDATION_ERROR", issues: parsedQuery.error.issues });
      return;
    }
    const items = await fetchInbox({
      orgId: req.deviceContext.orgId,
      toAgentInstanceId: req.deviceContext.agentInstanceId,
      maxBatch: parsedQuery.data.limit ?? cfg.RELAY_POLL_MAX_BATCH,
      markDelivered: true
    });
    reply.send({ items, server_time: new Date().toISOString() });
  });

  app.post("/v1/relay/a2a/:relay_task_id/ack", { preHandler: requireDeviceAuth() }, async (req, reply) => {
    if (!req.deviceContext) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    const { relay_task_id } = req.params as { relay_task_id: string };
    try {
      const result = await ackRelay(req.deviceContext.orgId, relay_task_id, req.deviceContext.agentInstanceId);
      reply.send(result);
    } catch (err) {
      reply.code(400).send({ error: "RELAY_ACK_FAILED", message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/v1/relay/a2a/:relay_task_id/respond", { preHandler: requireDeviceAuth() }, async (req, reply) => {
    if (!req.deviceContext) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    const { relay_task_id } = req.params as { relay_task_id: string };
    try {
      const body = RespondSchema.parse(req.body);
      const result = await respondRelay(
        req.deviceContext.orgId,
        relay_task_id,
        req.deviceContext.agentInstanceId,
        body.payload
      );
      reply.send(result);
    } catch (err) {
      if (err instanceof ZodError) {
        reply.code(400).send({ error: "VALIDATION_ERROR", issues: err.issues });
        return;
      }
      reply.code(400).send({ error: "RELAY_RESPOND_FAILED", message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/v1/relay/a2a/tasks/:relay_task_id", { preHandler: requireDeviceAuth() }, async (req, reply) => {
    if (!req.deviceContext) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    const { relay_task_id } = req.params as { relay_task_id: string };
    try {
      const task = await getRelayTask(req.deviceContext.orgId, relay_task_id, req.deviceContext.agentInstanceId);
      if (!task) {
        reply.code(404).send({ error: "NOT_FOUND" });
        return;
      }
      reply.send(task);
    } catch (err) {
      reply.code(403).send({ error: "FORBIDDEN", message: err instanceof Error ? err.message : String(err) });
    }
  });
}
