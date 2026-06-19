import { randomUUID } from "node:crypto";
import { getControlPlaneStore } from "../db/connection.js";
import type { ControlPlaneStore } from "../db/ControlPlaneStore.js";
import { loadConfig } from "../config.js";
import { hashPassword, verifyPassword, validatePasswordStrength } from "./PasswordHasher.js";
import {
  generateOpaqueToken,
  hashOpaqueToken,
  issueAccessToken,
  issueDeviceToken,
  verifyAccessToken
} from "./TokenService.js";
import type { User, OrgId, UserId } from "../types/cloud.js";

export interface SignupInput {
  orgSlug?: string;
  email: string;
  displayName: string;
  password: string;
}

export interface LoginInput {
  orgSlug?: string;
  email: string;
  password: string;
}

export interface TokenBundle {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: {
    org_id: OrgId;
    user_id: UserId;
    email: string;
    display_name: string;
  };
}

export interface DeviceTokenBundle {
  device_access_token: string;
  refresh_token: string;
  expires_in: number;
}

export class AuthError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "AuthError";
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function signup(input: SignupInput, store?: ControlPlaneStore): Promise<TokenBundle> {
  const conn = store ?? getControlPlaneStore();
  const cfg = loadConfig();
  const email = normalizeEmail(input.email);
  const strength = validatePasswordStrength(input.password);
  if (!strength.ok) throw new AuthError("WEAK_PASSWORD", strength.reason ?? "Invalid password");
  if (!input.displayName.trim()) throw new AuthError("INVALID_DISPLAY_NAME", "Display name is required");
  if (input.displayName.length > 120) throw new AuthError("INVALID_DISPLAY_NAME", "Display name too long");

  const orgSlug = input.orgSlug ?? loadConfig().DEFAULT_ORG_SLUG;
  const org = await conn.one<{ id: string; slug: string }>("SELECT id, slug FROM organizations WHERE slug = $1", [orgSlug]);
  if (!org) throw new AuthError("ORG_NOT_FOUND", `Organization '${orgSlug}' does not exist`);

  const existing = await conn.one("SELECT id FROM users WHERE org_id = $1 AND email = $2", [org.id, email]);
  if (existing) throw new AuthError("DUPLICATE_USER", "A user with this email already exists in this organization");

  const userId = `usr_${randomUUID()}`;
  const now = new Date().toISOString();
  const { hash } = await hashPassword(input.password);
  await conn.transaction(async (tx) => {
    await tx.execute(`
      INSERT INTO users (id, org_id, email, display_name, status, created_at)
      VALUES ($1, $2, $3, $4, 'active', $5)
    `, [userId, org.id, email, input.displayName.trim(), now]);
    await tx.execute(`
      INSERT INTO user_credentials (user_id, password_hash, password_algo, created_at, updated_at)
      VALUES ($1, $2, 'argon2id', $3, $4)
    `, [userId, hash, now, now]);
  });

  const refresh = generateOpaqueToken();
  const refreshId = `rft_${randomUUID()}`;
  await conn.execute(`
    INSERT INTO refresh_tokens (id, org_id, user_id, token_hash, expires_at, created_at)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [refreshId, org.id, userId, refresh.hash, new Date(Date.now() + cfg.REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(), now]);

  const access = issueAccessToken({ userId, orgId: org.id, email, displayName: input.displayName.trim() });
  return {
    access_token: access.token,
    refresh_token: refresh.token,
    expires_in: access.expiresIn,
    user: {
      org_id: org.id,
      user_id: userId,
      email,
      display_name: input.displayName.trim()
    }
  };
}

export async function login(input: LoginInput, store?: ControlPlaneStore): Promise<TokenBundle> {
  const conn = store ?? getControlPlaneStore();
  const cfg = loadConfig();
  const email = normalizeEmail(input.email);
  const orgSlug = input.orgSlug ?? cfg.DEFAULT_ORG_SLUG;
  const org = await conn.one<{ id: string }>("SELECT id FROM organizations WHERE slug = $1", [orgSlug]);
  if (!org) throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password");
  const user = await conn.one("SELECT * FROM users WHERE org_id = $1 AND email = $2", [org.id, email]);
  if (!user) throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password");
  if (user.status !== "active") throw new AuthError("USER_DISABLED", "User is not active");
  const creds = await conn.one("SELECT * FROM user_credentials WHERE user_id = $1", [user.id]);
  if (!creds) throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password");
  const ok = await verifyPassword(input.password, String(creds.password_hash));
  if (!ok) throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password");

  const now = new Date().toISOString();
  const refresh = generateOpaqueToken();
  const refreshId = `rft_${randomUUID()}`;
  await conn.execute(`
    INSERT INTO refresh_tokens (id, org_id, user_id, token_hash, expires_at, created_at)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [refreshId, org.id, String(user.id), refresh.hash, new Date(Date.now() + cfg.REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(), now]);

  const access = issueAccessToken({
    userId: String(user.id),
    orgId: org.id,
    email: String(user.email),
    displayName: String(user.display_name)
  });
  return {
    access_token: access.token,
    refresh_token: refresh.token,
    expires_in: access.expiresIn,
    user: {
      org_id: org.id,
      user_id: String(user.id),
      email: String(user.email),
      display_name: String(user.display_name)
    }
  };
}

export interface RefreshResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export async function refreshAccessToken(refreshToken: string, store?: ControlPlaneStore): Promise<RefreshResult> {
  const conn = store ?? getControlPlaneStore();
  return conn.transaction(async (tx) => {
    const cfg = loadConfig();
    const tokenHash = hashOpaqueToken(refreshToken);
    const row = await tx.one("SELECT * FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE", [tokenHash]);
    if (!row) throw new AuthError("INVALID_REFRESH_TOKEN", "Refresh token not found");
    if (row.revoked_at) throw new AuthError("REVOKED_REFRESH_TOKEN", "Refresh token has been revoked");
    const expiresAt = new Date(String(row.expires_at)).getTime();
    if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
      throw new AuthError("EXPIRED_REFRESH_TOKEN", "Refresh token has expired");
    }
    const user = await tx.one("SELECT * FROM users WHERE org_id = $1 AND id = $2", [row.org_id, row.user_id]);
    if (!user) throw new AuthError("USER_NOT_FOUND", "User not found");
    if (user.status !== "active") throw new AuthError("USER_DISABLED", "User is not active");

    const now = new Date().toISOString();
    const revoked = await tx.execute("UPDATE refresh_tokens SET revoked_at = $1 WHERE id = $2 AND revoked_at IS NULL", [now, row.id]);
    if (Number(revoked.changes) !== 1) {
      throw new AuthError("REVOKED_REFRESH_TOKEN", "Refresh token has been revoked");
    }

    const nextRefresh = generateOpaqueToken();
    await tx.execute(`
      INSERT INTO refresh_tokens (id, org_id, user_id, token_hash, expires_at, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      `rft_${randomUUID()}`,
      String(row.org_id),
      String(row.user_id),
      nextRefresh.hash,
      new Date(Date.now() + cfg.REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(),
      now
    ]);

    const access = issueAccessToken({
      userId: String(user.id),
      orgId: String(user.org_id),
      email: String(user.email),
      displayName: String(user.display_name)
    });
    return { access_token: access.token, refresh_token: nextRefresh.token, expires_in: access.expiresIn };
  });
}

export async function logout(refreshToken: string, store?: ControlPlaneStore): Promise<boolean> {
  const conn = store ?? getControlPlaneStore();
  const tokenHash = hashOpaqueToken(refreshToken);
  const result = await conn.execute("UPDATE refresh_tokens SET revoked_at = $1 WHERE token_hash = $2 AND revoked_at IS NULL", [
    new Date().toISOString(),
    tokenHash
  ]);
  return Number(result.changes) > 0;
}

export async function getMeFromToken(accessToken: string, store?: ControlPlaneStore): Promise<{
  org_id: OrgId;
  user_id: UserId;
  email: string;
  display_name: string;
  status: string;
}> {
  const claims = verifyAccessToken(accessToken);
  const conn = store ?? getControlPlaneStore();
  const user = await conn.one("SELECT * FROM users WHERE org_id = $1 AND id = $2", [claims.org, claims.sub]);
  if (!user) throw new AuthError("USER_NOT_FOUND", "User not found");
  return {
    org_id: String(user.org_id),
    user_id: String(user.id),
    email: String(user.email),
    display_name: String(user.display_name),
    status: String(user.status)
  };
}

export function rowToUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    email: String(row.email),
    displayName: String(row.display_name),
    status: String(row.status) as User["status"],
    createdAt: String(row.created_at)
  };
}
