import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import { loadConfig } from "../config.js";
import {
  AdminAuthError,
  getSetupStatus,
  loginStep1,
  logout,
  meFromSession,
  setupFirstAdmin,
  startSetup,
  verifyMfaRecovery,
  verifyMfaTotp,
  sessionCookieName
} from "./AdminAuthService.js";
import { resolveSession, touchSession, type ResolvedSession } from "./AdminSessionService.js";

interface AdminContext {
  adminUserId: string;
  email: string;
  displayName: string;
  sessionId: string;
  expiresAt: string;
}

const SetupSchema = z.object({
  email: z.string().email().max(254),
  display_name: z.string().min(1).max(120),
  password: z.string().min(8).max(256),
  totp_code: z.string().regex(/^\d{6}$/),
  setup_challenge: z.string().min(16).max(256)
});

const LoginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256)
});

const MfaSchema = z.object({
  challenge: z.string().min(16).max(256),
  totp_code: z.string().regex(/^\d{6}$/)
});

const RecoverySchema = z.object({
  challenge: z.string().min(16).max(256),
  recovery_code: z.string().min(8).max(32)
});

function sessionContext(req: FastifyRequest): { ipAddress: string | null; userAgent: string | null } {
  const ip = (req.ip as string | undefined) ?? null;
  const ua = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null;
  return { ipAddress: ip, userAgent: ua };
}

function setSessionCookie(reply: FastifyReply, token: string, expiresAt: string): void {
  const cfg = loadConfig();
  const isProd = cfg.ADMIN_COOKIE_HOST_PREFIX === "true";
  reply.setCookie(sessionCookieName(), token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    path: "/",
    expires: new Date(expiresAt),
    // No `domain` — keeps the cookie host-bound; required for __Host- prefix.
    signed: false
  });
}

function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(sessionCookieName(), { path: "/" });
}

function handleAuthError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof AdminAuthError) {
    const status = err.code === "RATE_LIMITED" ? 429 : 400;
    reply.code(status).send({ error: err.code, message: err.message });
    return reply;
  }
  if (err instanceof ZodError) {
    reply.code(400).send({ error: "VALIDATION_ERROR", message: "Invalid request", issues: err.issues });
    return reply;
  }
  throw err;
}

export async function registerAdminAuthRoutes(app: FastifyInstance): Promise<void> {
  // Cookie parsing is registered globally in main.ts via @fastify/cookie.

  app.get("/v1/admin/auth/setup-status", async (_req, reply) => {
    return getSetupStatus();
  });

  app.post("/v1/admin/auth/setup/start", async (_req, reply) => {
    try {
      const result = await startSetup();
      reply.send({
        challenge: result.challenge,
        provisioning_uri: result.provisioningUri,
        secret_base32: result.secretBase32,
        expires_in: result.expiresIn
      });
    } catch (err) {
      handleAuthError(reply, err);
    }
  });

  app.post("/v1/admin/auth/setup", async (req, reply) => {
    try {
      const body = SetupSchema.parse(req.body);
      const result = await setupFirstAdmin(
        {
          email: body.email,
          displayName: body.display_name,
          password: body.password,
          totpCode: body.totp_code,
          setupChallenge: body.setup_challenge
        },
        sessionContext(req)
      );
      setSessionCookie(reply, result.session.token, result.session.absoluteExpiresAt);
      reply.code(201).send({
        user: {
          id: result.user.id,
          email: result.user.email,
          display_name: result.user.display_name,
          totp_enrolled: result.user.totp_enrolled
        },
        recovery_codes: result.recoveryCodes
      });
    } catch (err) {
      handleAuthError(reply, err);
    }
  });

  app.post("/v1/admin/auth/login", async (req, reply) => {
    try {
      const body = LoginSchema.parse(req.body);
      const result = await loginStep1(
        { email: body.email, password: body.password },
        sessionContext(req)
      );
      if (result.kind === "mfa_required") {
        reply.code(200).send({
          status: "mfa_required",
          challenge: result.challenge,
          expires_in: result.expiresIn
        });
        return;
      }
      setSessionCookie(reply, result.session.token, result.session.absoluteExpiresAt);
      reply.send({
        status: "ok",
        user: {
          id: result.user.id,
          email: result.user.email,
          display_name: result.user.display_name,
          totp_enrolled: result.user.totp_enrolled
        }
      });
    } catch (err) {
      handleAuthError(reply, err);
    }
  });

  app.post("/v1/admin/auth/mfa/verify", async (req, reply) => {
    try {
      const body = MfaSchema.parse(req.body);
      const result = await verifyMfaTotp(body.challenge, body.totp_code, sessionContext(req));
      setSessionCookie(reply, result.session.token, result.session.absoluteExpiresAt);
      reply.send({
        user: {
          id: result.user.id,
          email: result.user.email,
          display_name: result.user.display_name,
          totp_enrolled: result.user.totp_enrolled
        }
      });
    } catch (err) {
      handleAuthError(reply, err);
    }
  });

  app.post("/v1/admin/auth/mfa/recovery", async (req, reply) => {
    try {
      const body = RecoverySchema.parse(req.body);
      const result = await verifyMfaRecovery(body.challenge, body.recovery_code, sessionContext(req));
      setSessionCookie(reply, result.session.token, result.session.absoluteExpiresAt);
      reply.send({
        user: {
          id: result.user.id,
          email: result.user.email,
          display_name: result.user.display_name,
          totp_enrolled: result.user.totp_enrolled
        },
        recovery_codes: result.newRecoveryCodes
      });
    } catch (err) {
      handleAuthError(reply, err);
    }
  });

  app.get("/v1/admin/auth/me", async (req, reply) => {
    const rawToken = readSessionCookie(req);
    const user = await meFromSession(rawToken);
    if (!user) {
      reply.code(401).send({ error: "UNAUTHORIZED", message: "No active admin session" });
      return;
    }
    reply.send({
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        totp_enrolled: user.totp_enrolled
      }
    });
  });

  app.post("/v1/admin/auth/logout", async (req, reply) => {
    const rawToken = readSessionCookie(req);
    if (rawToken !== null) {
      await logout(rawToken);
    }
    clearSessionCookie(reply);
    reply.code(204).send();
  });
}

export function readSessionCookie(req: FastifyRequest): string | null {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  if (!cookies) return null;
  return cookies[sessionCookieName()] ?? null;
}

export async function attachSessionContext(req: FastifyRequest): Promise<void> {
  const rawToken = readSessionCookie(req);
  if (!rawToken) return;
  const resolved = await resolveSession(rawToken);
  if (resolved) {
    (req as { adminContext?: ResolvedSession }).adminContext = resolved;
    await touchSession(resolved.sessionId);
  }
}
