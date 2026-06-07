import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { signup, login, refreshAccessToken, logout, getMeFromToken, AuthError } from "./AuthService.js";
import { requireUserAuth } from "./AuthMiddleware.js";

const SignupSchema = z.object({
  org_slug: z.string().min(1).max(80).optional(),
  email: z.string().email().max(254),
  display_name: z.string().min(1).max(120),
  password: z.string().min(8).max(256)
});

const LoginSchema = z.object({
  org_slug: z.string().min(1).max(80).optional(),
  email: z.string().email().max(254),
  password: z.string().min(1).max(256)
});

const RefreshSchema = z.object({
  refresh_token: z.string().min(8)
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/auth/signup", async (req, reply) => {
    try {
      const body = SignupSchema.parse(req.body);
      const result = await signup({
        orgSlug: body.org_slug,
        email: body.email,
        displayName: body.display_name,
        password: body.password
      });
      reply.code(201).send(result);
    } catch (err) {
      if (err instanceof AuthError) {
        reply.code(400).send({ error: err.code, message: err.message });
        return;
      }
      if (err instanceof ZodError) {
        reply.code(400).send({ error: "VALIDATION_ERROR", message: "Invalid request", issues: err.issues });
        return;
      }
      throw err;
    }
  });

  app.post("/v1/auth/login", async (req, reply) => {
    try {
      const body = LoginSchema.parse(req.body);
      const result = await login({
        orgSlug: body.org_slug,
        email: body.email,
        password: body.password
      });
      reply.send(result);
    } catch (err) {
      if (err instanceof AuthError) {
        reply.code(401).send({ error: err.code, message: err.message });
        return;
      }
      if (err instanceof ZodError) {
        reply.code(400).send({ error: "VALIDATION_ERROR", message: "Invalid request", issues: err.issues });
        return;
      }
      throw err;
    }
  });

  app.post("/v1/auth/refresh", async (req, reply) => {
    try {
      const body = RefreshSchema.parse(req.body);
      const result = refreshAccessToken(body.refresh_token);
      reply.send(result);
    } catch (err) {
      if (err instanceof AuthError) {
        reply.code(401).send({ error: err.code, message: err.message });
        return;
      }
      if (err instanceof ZodError) {
        reply.code(400).send({ error: "VALIDATION_ERROR", message: "Invalid request", issues: err.issues });
        return;
      }
      throw err;
    }
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    try {
      const body = RefreshSchema.parse(req.body);
      const ok = logout(body.refresh_token);
      reply.send({ ok });
    } catch (err) {
      if (err instanceof ZodError) {
        reply.code(400).send({ error: "VALIDATION_ERROR", message: "Invalid request", issues: err.issues });
        return;
      }
      throw err;
    }
  });

  app.get("/v1/auth/me", { preHandler: requireUserAuth() }, async (req, reply) => {
    try {
      const header = req.headers.authorization;
      const token = typeof header === "string" ? header.split(" ", 2)[1] : "";
      if (!token) {
        reply.code(401).send({ error: "UNAUTHORIZED", message: "Missing token" });
        return;
      }
      const me = getMeFromToken(token);
      reply.send({ user: me });
    } catch (err) {
      if (err instanceof AuthError) {
        reply.code(401).send({ error: err.code, message: err.message });
        return;
      }
      throw err;
    }
  });
}
