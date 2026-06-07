import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { requireDeviceAuth } from "./../auth/AuthMiddleware.js";
import { recordHeartbeat } from "./PresenceService.js";

const HeartbeatSchema = z.object({
  agent_instance_id: z.string().min(1),
  device_id: z.string().min(1).optional(),
  agent_id: z.string().min(1).optional(),
  version: z.string().max(40).optional(),
  status: z.enum(["online", "stale", "offline", "revoked"]),
  capabilities: z.array(z.string().min(1).max(120)).max(50).optional(),
  agent_card_hash: z.string().min(8).max(120).optional(),
  local_queue_depth: z.number().int().min(0).max(1000000).optional()
});

export async function registerPresenceRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/presence/heartbeat", { preHandler: requireDeviceAuth() }, async (req, reply) => {
    if (!req.deviceContext) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    try {
      const body = HeartbeatSchema.parse(req.body);
      if (body.agent_instance_id !== req.deviceContext.agentInstanceId) {
        reply.code(403).send({ error: "AGENT_INSTANCE_MISMATCH" });
        return;
      }
      const result = recordHeartbeat(req.deviceContext.orgId, body);
      reply.send(result);
    } catch (err) {
      if (err instanceof ZodError) {
        reply.code(400).send({ error: "VALIDATION_ERROR", issues: err.issues });
        return;
      }
      reply.code(400).send({ error: "HEARTBEAT_FAILED", message: err instanceof Error ? err.message : String(err) });
    }
  });
}
