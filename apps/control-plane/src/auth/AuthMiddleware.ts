import type { FastifyReply, FastifyRequest } from "fastify";
import { hashOpaqueToken, toAuthContext, toDeviceAuthContext, verifyAccessToken, verifyDeviceToken } from "./TokenService.js";
import { getDb } from "../db/connection.js";
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
      const db = getDb();
      const tokenRow = db.prepare(`
        SELECT * FROM device_tokens
        WHERE org_id = ? AND user_id = ? AND device_id = ? AND token_hash = ?
      `).get(claims.org, claims.user, claims.device, hashOpaqueToken(token)) as Record<string, unknown> | undefined;
      if (!tokenRow || tokenRow.revoked_at) {
        reply.code(401).send({ error: "DEVICE_TOKEN_REVOKED", message: "Device token is not active" });
        return reply;
      }
      if (new Date(String(tokenRow.expires_at)).getTime() < Date.now()) {
        reply.code(401).send({ error: "DEVICE_TOKEN_EXPIRED", message: "Device token has expired" });
        return reply;
      }
      const row = db.prepare(`
        SELECT d.status AS device_status, ai.status AS agent_instance_status, a.status AS agent_status, u.status AS user_status
        FROM devices d
        JOIN agent_instances ai ON ai.org_id = d.org_id AND ai.device_id = d.id
        JOIN agents a ON a.org_id = ai.org_id AND a.id = ai.agent_id
        JOIN users u ON u.org_id = d.org_id AND u.id = d.user_id
        WHERE d.org_id = ? AND d.id = ? AND ai.id = ? AND ai.agent_id = ? AND d.user_id = ?
      `).get(claims.org, claims.device, claims.sub, claims.agent, claims.user) as Record<string, unknown> | undefined;
      if (!row) {
        reply.code(401).send({ error: "DEVICE_NOT_FOUND", message: "Device or agent instance is not enrolled" });
        return reply;
      }
      if (row.user_status !== "active" || row.device_status !== "active" || row.agent_status !== "active" || row.agent_instance_status !== "active") {
        reply.code(403).send({
          error: "DEVICE_DISABLED",
          message: "Disabled or revoked devices cannot use device-authenticated routes"
        });
        return reply;
      }
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
