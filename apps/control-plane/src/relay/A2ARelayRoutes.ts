import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { requireDeviceAuth, requireUserAuth } from "./../auth/AuthMiddleware.js";
import {
  ackRelay, fetchInbox, getRelayTask, respondRelay, sendRelay
} from "./A2ARelayService.js";
import { loadConfig } from "./../config.js";

const SendSchema = z.object({
  to_agent_instance_id: z.string().min(1),
  a2a_task_id: z.string().min(1).max(120),
  type: z.string().min(1).max(80),
  payload: z.record(z.unknown()),
  idempotency_key: z.string().min(1).max(200).optional()
});

const RespondSchema = z.object({
  payload: z.record(z.unknown())
});

export async function registerA2ARelayRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/relay/a2a/send", { preHandler: requireDeviceAuth() }, async (req, reply) => {
    if (!req.deviceContext) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    try {
      const body = SendSchema.parse(req.body);
      const result = sendRelay({
        orgId: req.deviceContext.orgId,
        fromAgentInstanceId: req.deviceContext.agentInstanceId,
        toAgentInstanceId: body.to_agent_instance_id as never,
        a2aTaskId: body.a2a_task_id,
        type: body.type,
        payload: body.payload,
        idempotencyKey: body.idempotency_key
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
    const items = fetchInbox({
      orgId: req.deviceContext.orgId,
      toAgentInstanceId: req.deviceContext.agentInstanceId,
      maxBatch: cfg.RELAY_POLL_MAX_BATCH,
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
      const result = ackRelay(req.deviceContext.orgId, relay_task_id, req.deviceContext.agentInstanceId);
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
      const result = respondRelay(
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
      const task = getRelayTask(req.deviceContext.orgId, relay_task_id, req.deviceContext.agentInstanceId);
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
