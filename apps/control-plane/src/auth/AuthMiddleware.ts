import type { FastifyReply, FastifyRequest } from "fastify";
import { toAuthContext, toDeviceAuthContext, verifyAccessToken, verifyDeviceToken } from "./TokenService.js";
import { resolveSession as resolveAdminSession, cookieName as adminCookieName, touchSession } from "../admin/AdminSessionService.js";
import type { AuthContext, DeviceAuthContext } from "../types/cloud.js";
import type { ResolvedSession } from "../admin/AdminSessionService.js";

declare module "fastify" {
  interface FastifyRequest {
    authContext?: AuthContext;
    deviceContext?: DeviceAuthContext;
    adminContext?: ResolvedSession;
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
    // Path 1: production-quality session cookie. Used by the Admin Portal after password+TOTP login.
    const cookieToken = readAdminSessionCookie(req);
    if (cookieToken) {
      const resolved = resolveAdminSession(cookieToken);
      if (resolved) {
        req.adminContext = resolved;
        touchSession(resolved.sessionId);
        return;
      }
    }
    // Path 2: bootstrap / dev escape hatch. A static token set in ADMIN_BOOTSTRAP_TOKEN (or the legacy
    // DEV_ADMIN_TOKEN) is accepted only when set. Never set either in production.
    const expected = process.env.ADMIN_BOOTSTRAP_TOKEN ?? process.env.DEV_ADMIN_TOKEN;
    if (!expected) {
      reply.code(503).send({ error: "ADMIN_DISABLED", message: "Admin endpoints are not configured" });
      return reply;
    }
    const token = extractBearer(req) ?? (typeof req.headers["x-admin-token"] === "string" ? req.headers["x-admin-token"] : null);
    if (!token || token !== expected) {
      reply.code(401).send({ error: "UNAUTHORIZED", message: "Invalid admin credentials" });
      return reply;
    }
  };
}

// Strict session-cookie-only variant. Used by /v1/admin/auth/me and any future admin-only
// endpoint that must reject even a valid static bootstrap token (e.g. session-management UI).
export function requireAdminSession() {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const cookieToken = readAdminSessionCookie(req);
    if (!cookieToken) {
      reply.code(401).send({ error: "UNAUTHORIZED", message: "Admin session required" });
      return reply;
    }
    const resolved = resolveAdminSession(cookieToken);
    if (!resolved) {
      reply.code(401).send({ error: "UNAUTHORIZED", message: "Admin session expired or revoked" });
      return reply;
    }
    req.adminContext = resolved;
    touchSession(resolved.sessionId);
  };
}

function readAdminSessionCookie(req: FastifyRequest): string | null {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  if (!cookies) return null;
  // Accept either the prod (__Host- prefixed) or dev cookie name.
  return cookies["__Host-admin_session"] ?? cookies[adminCookieName()] ?? null;
}
