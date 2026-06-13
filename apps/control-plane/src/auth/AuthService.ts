import { randomUUID } from "node:crypto";
import type { Database as DB } from "better-sqlite3";
import { getDb } from "../db/connection.js";
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

export async function signup(input: SignupInput, db?: DB): Promise<TokenBundle> {
  const conn = db ?? getDb();
  const cfg = loadConfig();
  const email = normalizeEmail(input.email);
  const strength = validatePasswordStrength(input.password);
  if (!strength.ok) throw new AuthError("WEAK_PASSWORD", strength.reason ?? "Invalid password");
  if (!input.displayName.trim()) throw new AuthError("INVALID_DISPLAY_NAME", "Display name is required");
  if (input.displayName.length > 120) throw new AuthError("INVALID_DISPLAY_NAME", "Display name too long");

  const orgSlug = input.orgSlug ?? loadConfig().DEFAULT_ORG_SLUG;
  const org = conn.prepare("SELECT id, slug FROM organizations WHERE slug = ?").get(orgSlug) as { id: string; slug: string } | undefined;
  if (!org) throw new AuthError("ORG_NOT_FOUND", `Organization '${orgSlug}' does not exist`);

  const existing = conn.prepare("SELECT id FROM users WHERE org_id = ? AND email = ?").get(org.id, email);
  if (existing) throw new AuthError("DUPLICATE_USER", "A user with this email already exists in this organization");

  const userId = `usr_${randomUUID()}`;
  const now = new Date().toISOString();
  const { hash } = await hashPassword(input.password);
  conn.prepare("BEGIN").run();
  try {
    conn.prepare(`
      INSERT INTO users (id, org_id, email, display_name, status, created_at)
      VALUES (?, ?, ?, ?, 'active', ?)
    `).run(userId, org.id, email, input.displayName.trim(), now);
    conn.prepare(`
      INSERT INTO user_credentials (user_id, password_hash, password_algo, created_at, updated_at)
      VALUES (?, ?, 'argon2id', ?, ?)
    `).run(userId, hash, now, now);
  } catch (e) {
    conn.prepare("ROLLBACK").run();
    throw e;
  }
  conn.prepare("COMMIT").run();

  const refresh = generateOpaqueToken();
  const refreshId = `rft_${randomUUID()}`;
  conn.prepare(`
    INSERT INTO refresh_tokens (id, org_id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(refreshId, org.id, userId, refresh.hash, new Date(Date.now() + cfg.REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(), now);

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

export async function login(input: LoginInput, db?: DB): Promise<TokenBundle> {
  const conn = db ?? getDb();
  const cfg = loadConfig();
  const email = normalizeEmail(input.email);
  const orgSlug = input.orgSlug ?? cfg.DEFAULT_ORG_SLUG;
  const org = conn.prepare("SELECT id FROM organizations WHERE slug = ?").get(orgSlug) as { id: string } | undefined;
  if (!org) throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password");
  const user = conn.prepare("SELECT * FROM users WHERE org_id = ? AND email = ?").get(org.id, email) as Record<string, unknown> | undefined;
  if (!user) throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password");
  if (user.status !== "active") throw new AuthError("USER_DISABLED", "User is not active");
  const creds = conn.prepare("SELECT * FROM user_credentials WHERE user_id = ?").get(user.id) as Record<string, unknown> | undefined;
  if (!creds) throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password");
  const ok = await verifyPassword(input.password, String(creds.password_hash));
  if (!ok) throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password");

  const now = new Date().toISOString();
  const refresh = generateOpaqueToken();
  const refreshId = `rft_${randomUUID()}`;
  conn.prepare(`
    INSERT INTO refresh_tokens (id, org_id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(refreshId, org.id, String(user.id), refresh.hash, new Date(Date.now() + cfg.REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(), now);

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

export function refreshAccessToken(refreshToken: string, db?: DB): RefreshResult {
  const conn = db ?? getDb();
  return conn.transaction(() => {
    const cfg = loadConfig();
    const tokenHash = hashOpaqueToken(refreshToken);
    const row = conn.prepare("SELECT * FROM refresh_tokens WHERE token_hash = ?").get(tokenHash) as Record<string, unknown> | undefined;
    if (!row) throw new AuthError("INVALID_REFRESH_TOKEN", "Refresh token not found");
    if (row.revoked_at) throw new AuthError("REVOKED_REFRESH_TOKEN", "Refresh token has been revoked");
    const expiresAt = new Date(String(row.expires_at)).getTime();
    if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
      throw new AuthError("EXPIRED_REFRESH_TOKEN", "Refresh token has expired");
    }
    const user = conn.prepare("SELECT * FROM users WHERE id = ?").get(row.user_id) as Record<string, unknown> | undefined;
    if (!user) throw new AuthError("USER_NOT_FOUND", "User not found");
    if (user.status !== "active") throw new AuthError("USER_DISABLED", "User is not active");

    const now = new Date().toISOString();
    const revoked = conn.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(now, row.id);
    if (Number(revoked.changes) !== 1) {
      throw new AuthError("REVOKED_REFRESH_TOKEN", "Refresh token has been revoked");
    }

    const nextRefresh = generateOpaqueToken();
    conn.prepare(`
      INSERT INTO refresh_tokens (id, org_id, user_id, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      `rft_${randomUUID()}`,
      String(row.org_id),
      String(row.user_id),
      nextRefresh.hash,
      new Date(Date.now() + cfg.REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(),
      now
    );

    const access = issueAccessToken({
      userId: String(user.id),
      orgId: String(user.org_id),
      email: String(user.email),
      displayName: String(user.display_name)
    });
    return { access_token: access.token, refresh_token: nextRefresh.token, expires_in: access.expiresIn };
  })();
}

export function logout(refreshToken: string, db?: DB): boolean {
  const conn = db ?? getDb();
  const tokenHash = hashOpaqueToken(refreshToken);
  const result = conn.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
    .run(new Date().toISOString(), tokenHash);
  return Number(result.changes) > 0;
}

export function getMeFromToken(accessToken: string, db?: DB): {
  org_id: OrgId;
  user_id: UserId;
  email: string;
  display_name: string;
  status: string;
} {
  const claims = verifyAccessToken(accessToken);
  const conn = db ?? getDb();
  const user = conn.prepare("SELECT * FROM users WHERE id = ?").get(claims.sub) as Record<string, unknown> | undefined;
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
