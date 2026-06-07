import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { requireUserAuth } from "./../auth/AuthMiddleware.js";
import { acceptContact, listContacts, requestContact } from "./ContactsService.js";

const RequestSchema = z.object({
  target_user_id: z.string().min(1)
});

export async function registerContactsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/contacts/request", { preHandler: requireUserAuth() }, async (req, reply) => {
    if (!req.authContext) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    try {
      const body = RequestSchema.parse(req.body);
      const result = requestContact(req.authContext.orgId, req.authContext.userId, body.target_user_id);
      reply.send(result);
    } catch (err) {
      if (err instanceof ZodError) {
        reply.code(400).send({ error: "VALIDATION_ERROR", issues: err.issues });
        return;
      }
      reply.code(400).send({ error: "CONTACT_REQUEST_FAILED", message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/v1/contacts/:contact_id/accept", { preHandler: requireUserAuth() }, async (req, reply) => {
    if (!req.authContext) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    const { contact_id } = req.params as { contact_id: string };
    try {
      const result = acceptContact(req.authContext.orgId, contact_id, req.authContext.userId);
      reply.send(result);
    } catch (err) {
      reply.code(400).send({ error: "CONTACT_ACCEPT_FAILED", message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/v1/contacts", { preHandler: requireUserAuth() }, async (req, reply) => {
    if (!req.authContext) {
      reply.code(401).send({ error: "UNAUTHORIZED" });
      return;
    }
    const result = listContacts(req.authContext.orgId, req.authContext.userId);
    reply.send({ contacts: result });
  });
}
