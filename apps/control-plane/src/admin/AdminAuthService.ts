import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hashPassword, verifyPassword, validatePasswordStrength } from "../auth/PasswordHasher.js";
import { getControlPlaneStore } from "../db/connection.js";
import type { ControlPlaneStore } from "../db/ControlPlaneStore.js";
import { loadConfig } from "../config.js";
import { generateOpaqueToken } from "../auth/TokenService.js";
import * as TOTP from "./TOTPService.js";
import * as Sessions from "./AdminSessionService.js";
import * as RateLimit from "./AdminRateLimit.js";
import { encryptSecret } from "./AdminCrypto.js";

export class AdminAuthError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "AdminAuthError";
  }
}

export interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  is_disabled: boolean;
  created_at: string;
  totp_enrolled: boolean;
}

interface AdminUserRow {
  id: string;
  email: string;
  display_name: string;
  is_disabled: boolean;
  created_at: string;
}

async function rowToAdminUser(row: AdminUserRow): Promise<AdminUser> {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    is_disabled: Boolean(row.is_disabled),
    created_at: String(row.created_at),
    totp_enrolled: await TOTP.isEnrolled(row.id)
  };
}

async function findByEmail(emailLower: string): Promise<AdminUser | null> {
  const row = await getControlPlaneStore().one<AdminUserRow>(
    "SELECT id, email, display_name, is_disabled, created_at FROM admin_users WHERE email = $1",
    [emailLower]
  );
  return row ? rowToAdminUser(row) : null;
}

async function findById(id: string): Promise<AdminUser | null> {
  const row = await getControlPlaneStore().one<AdminUserRow>(
    "SELECT id, email, display_name, is_disabled, created_at FROM admin_users WHERE id = $1",
    [id]
  );
  return row ? rowToAdminUser(row) : null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function countAdmins(store: ControlPlaneStore = getControlPlaneStore()): Promise<number> {
  const row = await store.one<{ n: string | number }>("SELECT COUNT(*) AS n FROM admin_users");
  return Number(row?.n ?? 0);
}

export async function getSetupStatus(): Promise<{ required: boolean; has_any_admin: boolean }> {
  const n = await countAdmins();
  return { required: n === 0, has_any_admin: n > 0 };
}

function assertSetupAllowed(): void {
  const cfg = loadConfig();
  if (cfg.CONTROL_PLANE_ENV === "production" && cfg.ADMIN_SETUP_ENABLED !== "true") {
    throw new AdminAuthError(
      "SETUP_DISABLED_PRODUCTION",
      "Admin setup is disabled in production unless ADMIN_SETUP_ENABLED=true"
    );
  }
}

export interface SetupInput {
  email: string;
  displayName: string;
  password: string;
  totpCode: string;
  setupChallenge: string;
}

export interface SetupResult {
  user: AdminUser;
  session: Sessions.IssuedSession;
  recoveryCodes: string[];
}

export interface SetupStartResult {
  challenge: string;
  provisioningUri: string;
  secretBase32: string;
  expiresIn: number;
}

const SETUP_TTL_SECONDS = 600;

export async function startSetup(): Promise<SetupStartResult> {
  assertSetupAllowed();
  if ((await countAdmins()) > 0) {
    throw new AdminAuthError("SETUP_DISABLED", "An admin already exists; use login instead");
  }
  const generated = TOTP.generateSecret();
  const challenge = generateOpaqueToken().token;
  const challengeHash = createHash("sha256").update(challenge).digest("hex");
  const id = `asc_${randomUUID()}`;
  const encrypted = encryptSecret(generated.base32);
  const expiresAt = new Date(Date.now() + SETUP_TTL_SECONDS * 1000).toISOString();
  await getControlPlaneStore().execute(
    `INSERT INTO admin_setup_challenges
       (id, token_hash, totp_secret_encrypted, provisioning_uri, secret_base32, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, challengeHash, encrypted, generated.otpauthUri, generated.base32, expiresAt, new Date().toISOString()]
  );
  return { challenge, provisioningUri: generated.otpauthUri, secretBase32: generated.base32, expiresIn: SETUP_TTL_SECONDS };
}

interface SetupChallengeRow {
  id: string;
  secret_base32: string;
  expires_at: string;
  used_at: string | null;
}

async function consumeSetupChallenge(challenge: string, store: ControlPlaneStore): Promise<SetupChallengeRow | null> {
  const hash = createHash("sha256").update(challenge).digest("hex");
  const row = await store.one<SetupChallengeRow>(
    "SELECT id, secret_base32, expires_at, used_at FROM admin_setup_challenges WHERE token_hash = $1 FOR UPDATE",
    [hash]
  );
  if (!row) return null;
  if (row.used_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  const claimed = await store.execute(
    "UPDATE admin_setup_challenges SET used_at = $1 WHERE id = $2 AND used_at IS NULL",
    [new Date().toISOString(), row.id]
  );
  return claimed.changes === 1 ? row : null;
}

export async function setupFirstAdmin(input: SetupInput, ctx: Sessions.SessionContext): Promise<SetupResult> {
  assertSetupAllowed();
  const email = normalizeEmail(input.email);
  const strength = validatePasswordStrength(input.password);
  if (!strength.ok) throw new AdminAuthError("WEAK_PASSWORD", strength.reason ?? "Invalid password");
  if (!input.displayName.trim()) throw new AdminAuthError("INVALID_DISPLAY_NAME", "Display name is required");

  const userId = `adu_${randomUUID()}`;
  const now = new Date().toISOString();
  const { hash } = await hashPassword(input.password);

  await getControlPlaneStore().transaction(async (tx) => {
    if ((await countAdmins(tx)) > 0) {
      throw new AdminAuthError("SETUP_DISABLED", "An admin already exists; use login instead");
    }
    const challenge = await consumeSetupChallenge(input.setupChallenge, tx);
    if (!challenge) {
      throw new AdminAuthError("SETUP_CHALLENGE_INVALID", "Setup challenge is missing, expired, or already used");
    }
    if (!TOTP.verifyRaw(challenge.secret_base32, input.totpCode)) {
      throw new AdminAuthError("INVALID_TOTP", "TOTP code did not validate against the new secret");
    }
    const step = Math.floor(Date.now() / 1000 / 30);
    await tx.execute(
      `INSERT INTO admin_users (id, email, display_name, password_hash, password_algo, is_disabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'argon2id', FALSE, $5, $6)`,
      [userId, email, input.displayName.trim(), hash, now, now]
    );
    await tx.execute(
      "INSERT INTO admin_totp_secrets (admin_user_id, secret_encrypted, enrolled_at, last_used_counter) VALUES ($1, $2, $3, $4)",
      [userId, encryptSecret(challenge.secret_base32), now, step]
    );
  });

  const recoveryCodes = await generateRecoveryCodes(userId);
  const session = await Sessions.issueSession(userId, ctx);
  const user = await findById(userId);
  if (!user) throw new AdminAuthError("INTERNAL", "Failed to read back the created admin user");
  return { user, session, recoveryCodes };
}

export interface LoginStep1Input {
  email: string;
  password: string;
}

export type LoginStep1Result =
  | { kind: "mfa_required"; challenge: string; expiresIn: number }
  | { kind: "authenticated"; user: AdminUser; session: Sessions.IssuedSession };

export async function loginStep1(input: LoginStep1Input, ctx: Sessions.SessionContext): Promise<LoginStep1Result> {
  const email = normalizeEmail(input.email);
  const lockState = await RateLimit.isLockedOut(email, ctx.ipAddress);
  if (lockState.locked) {
    await RateLimit.recordAttempt({ emailLower: email, ipAddress: ctx.ipAddress, succeeded: false, reason: "LOCKED_OUT" });
    throw new AdminAuthError("RATE_LIMITED", "Too many failed attempts; try again later");
  }
  const user = await findByEmail(email);
  if (!user || user.is_disabled) {
    await RateLimit.recordAttempt({ emailLower: email, ipAddress: ctx.ipAddress, succeeded: false, reason: "UNKNOWN_USER" });
    throw new AdminAuthError("INVALID_CREDENTIALS", "Invalid email or password");
  }
  const creds = await getControlPlaneStore().one<{ password_hash: string }>(
    "SELECT password_hash FROM admin_users WHERE id = $1",
    [user.id]
  );
  if (!creds) {
    await RateLimit.recordAttempt({ emailLower: email, ipAddress: ctx.ipAddress, succeeded: false, reason: "NO_CREDENTIALS" });
    throw new AdminAuthError("INVALID_CREDENTIALS", "Invalid email or password");
  }
  if (!(await verifyPassword(input.password, creds.password_hash))) {
    await RateLimit.recordAttempt({ emailLower: email, ipAddress: ctx.ipAddress, succeeded: false, reason: "BAD_PASSWORD" });
    throw new AdminAuthError("INVALID_CREDENTIALS", "Invalid email or password");
  }
  if (user.totp_enrolled) {
    const challenge = generateOpaqueToken().token;
    const expiresIn = 300;
    await storeChallenge(challenge, user.id, expiresIn);
    return { kind: "mfa_required", challenge, expiresIn };
  }
  await RateLimit.clearAttemptsForEmail(email);
  await RateLimit.recordAttempt({ emailLower: email, ipAddress: ctx.ipAddress, succeeded: true });
  const session = await Sessions.issueSession(user.id, ctx);
  return { kind: "authenticated", user, session };
}

async function storeChallenge(challenge: string, adminUserId: string, ttlSeconds: number): Promise<void> {
  const hash = createHash("sha256").update(challenge).digest("hex");
  const id = `ach_${randomUUID()}`;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  await getControlPlaneStore().execute(
    "INSERT INTO admin_login_challenges (id, token_hash, admin_user_id, expires_at, created_at) VALUES ($1, $2, $3, $4, $5)",
    [id, hash, adminUserId, expiresAt, new Date().toISOString()]
  );
}

async function consumeChallenge(challenge: string): Promise<string | null> {
  const hash = createHash("sha256").update(challenge).digest("hex");
  return getControlPlaneStore().transaction(async (tx) => {
    const row = await tx.one<{ admin_user_id: string; expires_at: string; used_at: string | null }>(
      "SELECT admin_user_id, expires_at, used_at FROM admin_login_challenges WHERE token_hash = $1 FOR UPDATE",
      [hash]
    );
    if (!row) return null;
    if (row.used_at) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    const claimed = await tx.execute(
      "UPDATE admin_login_challenges SET used_at = $1 WHERE token_hash = $2 AND used_at IS NULL",
      [new Date().toISOString(), hash]
    );
    return claimed.changes === 1 ? row.admin_user_id : null;
  });
}

async function invalidateAllChallengesForUser(adminUserId: string): Promise<void> {
  await getControlPlaneStore().execute(
    "UPDATE admin_login_challenges SET used_at = $1 WHERE admin_user_id = $2 AND used_at IS NULL",
    [new Date().toISOString(), adminUserId]
  );
}

export interface MfaResult {
  user: AdminUser;
  session: Sessions.IssuedSession;
}

export async function verifyMfaTotp(challenge: string, totp: string, ctx: Sessions.SessionContext): Promise<MfaResult> {
  const adminUserId = await consumeChallenge(challenge);
  if (!adminUserId) throw new AdminAuthError("CHALLENGE_INVALID", "MFA challenge is invalid or expired");
  const user = await findById(adminUserId);
  if (!user) throw new AdminAuthError("USER_NOT_FOUND", "Admin user not found");
  if (user.is_disabled) throw new AdminAuthError("USER_DISABLED", "User is disabled");
  const result = await TOTP.verify(adminUserId, totp);
  if (!result.ok) {
    await invalidateAllChallengesForUser(adminUserId);
    throw new AdminAuthError("INVALID_TOTP", result.reason ?? "Invalid TOTP code");
  }
  await RateLimit.clearAttemptsForEmail(user.email);
  const session = await Sessions.issueSession(user.id, ctx);
  return { user, session };
}

export interface RecoveryResult {
  user: AdminUser;
  session: Sessions.IssuedSession;
  newRecoveryCodes: string[];
}

export async function verifyMfaRecovery(challenge: string, recoveryCode: string, ctx: Sessions.SessionContext): Promise<RecoveryResult> {
  const adminUserId = await consumeChallenge(challenge);
  if (!adminUserId) throw new AdminAuthError("CHALLENGE_INVALID", "MFA challenge is invalid or expired");
  const user = await findById(adminUserId);
  if (!user) throw new AdminAuthError("USER_NOT_FOUND", "Admin user not found");
  if (user.is_disabled) throw new AdminAuthError("USER_DISABLED", "User is disabled");
  const normalized = normalizeRecoveryCode(recoveryCode);
  if (normalized.length < 8 || normalized.length > 16) {
    await invalidateAllChallengesForUser(adminUserId);
    throw new AdminAuthError("INVALID_RECOVERY", "Recovery code is the wrong shape");
  }
  const hash = sha256Normalize(normalized);
  const row = await getControlPlaneStore().one<{ id: string }>(
    "SELECT id FROM admin_recovery_codes WHERE admin_user_id = $1 AND code_hash = $2 AND used_at IS NULL",
    [adminUserId, hash]
  );
  if (!row) {
    await invalidateAllChallengesForUser(adminUserId);
    throw new AdminAuthError("INVALID_RECOVERY", "Recovery code is invalid or already used");
  }
  await getControlPlaneStore().execute("UPDATE admin_recovery_codes SET used_at = $1 WHERE id = $2", [
    new Date().toISOString(),
    row.id
  ]);
  const newRecoveryCodes = await generateRecoveryCodes(adminUserId);
  await RateLimit.clearAttemptsForEmail(user.email);
  const session = await Sessions.issueSession(user.id, ctx);
  return { user, session, newRecoveryCodes };
}

async function generateRecoveryCodes(adminUserId: string): Promise<string[]> {
  const codes: string[] = [];
  await getControlPlaneStore().transaction(async (tx) => {
    await tx.execute("UPDATE admin_recovery_codes SET used_at = $1 WHERE admin_user_id = $2 AND used_at IS NULL", [
      new Date().toISOString(),
      adminUserId
    ]);
    for (let i = 0; i < 10; i++) {
      const code = formatRecoveryCode(randomBytes(8));
      codes.push(code);
      await tx.execute(
        "INSERT INTO admin_recovery_codes (id, admin_user_id, code_hash, used_at, created_at) VALUES ($1, $2, $3, NULL, $4)",
        [`arc_${randomUUID()}`, adminUserId, sha256Normalize(code), new Date().toISOString()]
      );
    }
  });
  return codes;
}

const RECOVERY_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

function formatRecoveryCode(bytes: Buffer): string {
  let bits = 0n;
  let bitCount = 0;
  let out = "";
  for (const b of bytes) {
    bits = (bits << 8n) | BigInt(b);
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      out += RECOVERY_ALPHABET[Number((bits >> BigInt(bitCount)) & 0x1fn)];
    }
  }
  return out.slice(0, 10).match(/.{1,5}/g)!.join("-");
}

function normalizeRecoveryCode(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

function sha256Normalize(input: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(input)).digest("hex");
}

export async function meFromSession(rawToken: string | null): Promise<AdminUser | null> {
  if (!rawToken) return null;
  const resolved = await Sessions.resolveSession(rawToken);
  if (!resolved) return null;
  const user = await findById(resolved.adminUserId);
  if (!user) return null;
  await Sessions.touchSession(resolved.sessionId);
  return user;
}

export async function logout(rawToken: string): Promise<boolean> {
  return Sessions.revokeSession(rawToken);
}

export function sessionCookieName(): string {
  return Sessions.cookieName();
}

export function challengeCookieName(): string {
  return Sessions.challengeCookieName();
}

export { TOTP };
export const __test = { generateRecoveryCodes, findByEmail, findById, normalizeRecoveryCode, formatRecoveryCode };
