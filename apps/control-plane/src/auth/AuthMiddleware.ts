import type { FastifyReply, FastifyRequest } from "fastify";
import { toAuthContext, toDeviceAuthContext, verifyAccessToken, verifyDeviceToken } from "./TokenService.js";
import type { AuthContext, DeviceAuthContext } from "../types/cloud.js";

declare module "fastify" {
  interface FastifyRequest {
    authContext?: AuthContext;
    deviceContext?: DeviceAuthContext;
  }
}

function extractBearer(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const [scheme, value] = header.split(" ", 2);
  if (scheme?.toLowerCase() !== "bearer" || !value) return null;
  return value.trim();
}

export function requireUserAuth() {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const token = extractBearer(req);
    if (!token) {
      reply.code(401).send({ error: "UNAUTHORIZED", message: "Missing access token" });
      return reply;
    }
    try {
      const claims = verifyAccessToken(token);
      req.authContext = toAuthContext(claims);
    } catch (err) {
      reply.code(401).send({ error: "UNAUTHORIZED", message: err instanceof Error ? err.message : "Invalid token" });
      return reply;
    }
  };
}

export function optionalUserAuth() {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const token = extractBearer(req);
    if (!token) return;
    try {
      const claims = verifyAccessToken(token);
      req.authContext = toAuthContext(claims);
    } catch {
      // ignore - optional
    }
  };
}

export function requireDeviceAuth() {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const token = extractBearer(req);
    if (!token) {
      reply.code(401).send({ error: "UNAUTHORIZED", message: "Missing device access token" });
      return reply;
    }
    try {
      const claims = verifyDeviceToken(token);
      req.deviceContext = toDeviceAuthContext(claims);
      // also populate authContext for backward compat
      req.authContext = {
        orgId: claims.org,
        userId: claims.user,
        email: "",
        displayName: "",
        scope: "device"
      };
    } catch (err) {
      reply.code(401).send({ error: "UNAUTHORIZED", message: err instanceof Error ? err.message : "Invalid device token" });
      return reply;
    }
  };
}

export function requireAdmin() {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const token = extractBearer(req) ?? (typeof req.headers["x-admin-token"] === "string" ? req.headers["x-admin-token"] : null);
    const expected = process.env.DEV_ADMIN_TOKEN;
    if (!expected) {
      reply.code(503).send({ error: "ADMIN_DISABLED", message: "Admin endpoints are not configured" });
      return reply;
    }
    if (!token || token !== expected) {
      reply.code(401).send({ error: "UNAUTHORIZED", message: "Invalid admin token" });
      return reply;
    }
  };
}
