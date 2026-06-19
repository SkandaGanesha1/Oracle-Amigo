import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireDeviceAuth, requireUserAuth } from "./../auth/AuthMiddleware.js";
import { getAgentInstance, getUserAgents, searchUsers } from "./DirectoryService.js";
import { loadConfig } from "../config.js";

export async function registerDirectoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/directory/users", { preHandler: requireUserAuth() }, async (req, reply) => {
    if (!req.authContext) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    const q = (req.query as { q?: string }).q ?? "";
    const limit = Math.min(Number((req.query as { limit?: string }).limit ?? 50), 200);
    const users = await searchUsers(req.authContext.orgId, q, { limit, publicBaseUrl: loadConfig().CONTROL_PLANE_PUBLIC_URL });
    reply.send({ users });
  });

  app.get("/v1/directory/users/:user_id/agents", { preHandler: requireUserAuth() }, async (req, reply) => {
    if (!req.authContext) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    const { user_id } = req.params as { user_id: string };
    const result = await getUserAgents(req.authContext.orgId, user_id, { publicBaseUrl: loadConfig().CONTROL_PLANE_PUBLIC_URL });
    if (!result) {
      reply.code(404).send({ error: "NOT_FOUND" });
      return;
    }
    reply.send(result);
  });

  app.get("/v1/directory/device/users/:user_id/agents", { preHandler: requireDeviceAuth() }, async (req, reply) => {
    if (!req.deviceContext) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    const { user_id } = req.params as { user_id: string };
    const result = await getUserAgents(req.deviceContext.orgId, user_id, { publicBaseUrl: loadConfig().CONTROL_PLANE_PUBLIC_URL });
    if (!result) {
      reply.code(404).send({ error: "NOT_FOUND" });
      return;
    }
    reply.send(result);
  });

  app.get("/v1/directory/agent-instances/:agent_instance_id", { preHandler: requireUserAuth() }, async (req, reply) => {
    if (!req.authContext) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    const { agent_instance_id } = z.object({ agent_instance_id: z.string().min(1) }).parse(req.params);
    const result = await getAgentInstance(req.authContext.orgId, agent_instance_id, { publicBaseUrl: loadConfig().CONTROL_PLANE_PUBLIC_URL });
    if (!result) {
      reply.code(404).send({ error: "NOT_FOUND" });
      return;
    }
    reply.send(result);
  });

  app.get("/v1/directory/device/agent-instances/:agent_instance_id", { preHandler: requireDeviceAuth() }, async (req, reply) => {
    if (!req.deviceContext) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    const { agent_instance_id } = z.object({ agent_instance_id: z.string().min(1) }).parse(req.params);
    const result = await getAgentInstance(req.deviceContext.orgId, agent_instance_id, { publicBaseUrl: loadConfig().CONTROL_PLANE_PUBLIC_URL });
    if (!result) {
      reply.code(404).send({ error: "NOT_FOUND" });
      return;
    }
    reply.send(result);
  });
}
