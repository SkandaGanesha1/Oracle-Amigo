import { randomBytes } from "node:crypto";
import { getControlPlaneStore } from "../db/connection.js";
import { createHash } from "node:crypto";
import { loadConfig } from "../config.js";

export interface SessionContext {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface IssuedSession {
  token: string;
  expiresAt: string;
  absoluteExpiresAt: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueSession(adminUserId: string, ctx: SessionContext): Promise<IssuedSession> {
  const cfg = loadConfig();
  const now = Date.now();
  const idleMs = cfg.ADMIN_SESSION_IDLE_TTL_SECONDS * 1000;
  const absMs = cfg.ADMIN_SESSION_ABSOLUTE_TTL_SECONDS * 1000;
  const expiresAt = new Date(now + idleMs).toISOString();
  const absoluteExpiresAt = new Date(now + absMs).toISOString();
  const id = `ads_${randomBytes(8).toString("base64url")}`;
  const token = randomBytes(32).toString("base64url");
  const token_hash = hashToken(token);
  const nowIso = new Date(now).toISOString();
  await getControlPlaneStore().execute(
      `INSERT INTO admin_sessions
        (id, admin_user_id, token_hash, ip_address, user_agent, created_at, expires_at, absolute_expires_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, adminUserId, token_hash, ctx.ipAddress, ctx.userAgent, nowIso, expiresAt, absoluteExpiresAt, nowIso]
  );
  return { token, expiresAt, absoluteExpiresAt };
}

export interface ResolvedSession {
  adminUserId: string;
  email: string;
  displayName: string;
  sessionId: string;
  expiresAt: string;
}

interface SessionRow {
  id: string;
  admin_user_id: string;
  expires_at: string;
  absolute_expires_at: string;
  last_seen_at: string;
  revoked_at: string | null;
  email: string;
  display_name: string;
  is_disabled: boolean;
}

export async function resolveSession(rawToken: string, now: number = Date.now()): Promise<ResolvedSession | null> {
  if (!rawToken || rawToken.length < 16) return null;
  const tokenHash = hashToken(rawToken);
  const row = await getControlPlaneStore().one<SessionRow & Record<string, unknown>>(
      `SELECT s.id, s.admin_user_id, s.expires_at, s.absolute_expires_at, s.last_seen_at, s.revoked_at,
              a.email AS email, a.display_name AS display_name, a.is_disabled AS is_disabled
       FROM admin_sessions s JOIN admin_users a ON a.id = s.admin_user_id
       WHERE s.token_hash = $1`,
    [tokenHash]
  );
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.is_disabled) return null;
  const expiresMs = new Date(row.expires_at).getTime();
  const absMs = new Date(row.absolute_expires_at).getTime();
  const lastSeenMs = new Date(row.last_seen_at).getTime();
  const cfg = loadConfig();
  if (absMs <= now) return null;
  if (expiresMs <= now) return null;
  if (lastSeenMs + cfg.ADMIN_SESSION_IDLE_TTL_SECONDS * 1000 <= now) return null;
  return {
    adminUserId: row.admin_user_id,
    email: row.email,
    displayName: row.display_name,
    sessionId: row.id,
    expiresAt: row.expires_at
  };
}

const LAST_SEEN_THROTTLE_MS = 60_000;

export async function touchSession(sessionId: string, now: number = Date.now()): Promise<void> {
  const cfg = loadConfig();
  const newExpires = new Date(now + cfg.ADMIN_SESSION_IDLE_TTL_SECONDS * 1000).toISOString();
  const nowIso = new Date(now).toISOString();
  // Throttle: only bump last_seen_at if it is older than the throttle window. The expires_at bump
  // always happens so idle sessions are evicted promptly.
  await getControlPlaneStore().execute(
      `UPDATE admin_sessions
         SET last_seen_at = CASE WHEN last_seen_at < $1 THEN $2 ELSE last_seen_at END,
             expires_at = $3
       WHERE id = $4 AND revoked_at IS NULL`,
    [new Date(now - LAST_SEEN_THROTTLE_MS).toISOString(), nowIso, newExpires, sessionId]
  );
}

export async function revokeSession(rawToken: string): Promise<boolean> {
  const tokenHash = hashToken(rawToken);
  const result = await getControlPlaneStore().execute(
    "UPDATE admin_sessions SET revoked_at = $1 WHERE token_hash = $2 AND revoked_at IS NULL",
    [new Date().toISOString(), tokenHash]
  );
  return Number(result.changes) > 0;
}

export async function revokeAllForUser(adminUserId: string): Promise<number> {
  const result = await getControlPlaneStore().execute(
    "UPDATE admin_sessions SET revoked_at = $1 WHERE admin_user_id = $2 AND revoked_at IS NULL",
    [new Date().toISOString(), adminUserId]
  );
  return Number(result.changes);
}

export function cookieName(): string {
  const cfg = loadConfig();
  return cfg.ADMIN_COOKIE_HOST_PREFIX === "true" ? "__Host-admin_session" : "admin_session";
}

export function challengeCookieName(): string {
  const cfg = loadConfig();
  return cfg.ADMIN_COOKIE_HOST_PREFIX === "true" ? "__Host-admin_challenge" : "admin_challenge";
}
