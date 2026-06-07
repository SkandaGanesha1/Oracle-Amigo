import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUserAuth } from "./../auth/AuthMiddleware.js";
import { getUserAgents, searchUsers } from "./DirectoryService.js";

export async function registerDirectoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/directory/users", { preHandler: requireUserAuth() }, async (req, reply) => {
    if (!req.authContext) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    const q = (req.query as { q?: string }).q ?? "";
    const limit = Math.min(Number((req.query as { limit?: string }).limit ?? 50), 200);
    const users = searchUsers(req.authContext.orgId, q, { limit });
    reply.send({ users });
  });

  app.get("/v1/directory/users/:user_id/agents", { preHandler: requireUserAuth() }, async (req, reply) => {
    if (!req.authContext) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    const { user_id } = req.params as { user_id: string };
    const result = getUserAgents(req.authContext.orgId, user_id);
    if (!result) {
      reply.code(404).send({ error: "NOT_FOUND" });
      return;
    }
    reply.send(result);
  });
}
