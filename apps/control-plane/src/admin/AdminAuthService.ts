import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hashPassword, verifyPassword, validatePasswordStrength } from "../auth/PasswordHasher.js";
import { getDb } from "../db/connection.js";
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
  is_disabled: number;
  created_at: string;
}

function rowToAdminUser(row: AdminUserRow, totpEnrolled: boolean): AdminUser {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    is_disabled: row.is_disabled === 1,
    created_at: row.created_at,
    totp_enrolled: totpEnrolled
  };
}

function findByEmail(emailLower: string): AdminUser | null {
  const row = getDb()
    .prepare("SELECT id, email, display_name, is_disabled, created_at FROM admin_users WHERE email = ?")
    .get(emailLower) as AdminUserRow | undefined;
  if (!row) return null;
  return rowToAdminUser(row, TOTP.isEnrolled(row.id));
}

function findById(id: string): AdminUser | null {
  const row = getDb()
    .prepare("SELECT id, email, display_name, is_disabled, created_at FROM admin_users WHERE id = ?")
    .get(id) as AdminUserRow | undefined;
  if (!row) return null;
  return rowToAdminUser(row, TOTP.isEnrolled(row.id));
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function countAdmins(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM admin_users").get() as { n: number };
  return row.n;
}

export function getSetupStatus(): { required: boolean; has_any_admin: boolean } {
  return { required: countAdmins() === 0, has_any_admin: countAdmins() > 0 };
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

const SETUP_TTL_SECONDS = 600; // 10 minutes

export function startSetup(): SetupStartResult {
  assertSetupAllowed();
  if (countAdmins() > 0) {
    throw new AdminAuthError("SETUP_DISABLED", "An admin already exists; use login instead");
  }
  const generated = TOTP.generateSecret();
  const challenge = generateOpaqueToken().token;
  const challengeHash = createHash("sha256").update(challenge).digest("hex");
  const id = `asc_${randomUUID()}`;
  const encrypted = encryptTotpSecret(generated.base32);
  const expiresAt = new Date(Date.now() + SETUP_TTL_SECONDS * 1000).toISOString();
  getDb()
    .prepare(
      `CREATE TABLE IF NOT EXISTS admin_setup_challenges (
         id TEXT PRIMARY KEY,
         token_hash TEXT UNIQUE NOT NULL,
         totp_secret_encrypted TEXT NOT NULL,
         provisioning_uri TEXT NOT NULL,
         secret_base32 TEXT NOT NULL,
         expires_at TEXT NOT NULL,
         used_at TEXT,
         created_at TEXT NOT NULL
       )`
    )
    .run();
  getDb()
    .prepare(
      `INSERT INTO admin_setup_challenges
         (id, token_hash, totp_secret_encrypted, provisioning_uri, secret_base32, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      challengeHash,
      encrypted,
      generated.otpauthUri,
      generated.base32,
      expiresAt,
      new Date().toISOString()
    );
  return { challenge, provisioningUri: generated.otpauthUri, secretBase32: generated.base32, expiresIn: SETUP_TTL_SECONDS };
}

function encryptTotpSecret(base32: string): string {
  return encryptSecret(base32);
}

interface SetupChallengeRow {
  id: string;
  totp_secret_encrypted: string;
  secret_base32: string;
  expires_at: string;
  used_at: string | null;
}

function consumeSetupChallenge(challenge: string): SetupChallengeRow | null {
  const hash = createHash("sha256").update(challenge).digest("hex");
  getDb()
    .prepare(
      `CREATE TABLE IF NOT EXISTS admin_setup_challenges (
         id TEXT PRIMARY KEY,
         token_hash TEXT UNIQUE NOT NULL,
         totp_secret_encrypted TEXT NOT NULL,
         provisioning_uri TEXT NOT NULL,
         secret_base32 TEXT NOT NULL,
         expires_at TEXT NOT NULL,
         used_at TEXT,
         created_at TEXT NOT NULL
       )`
    )
    .run();
  const row = getDb()
    .prepare(
      "SELECT id, totp_secret_encrypted, secret_base32, expires_at, used_at FROM admin_setup_challenges WHERE token_hash = ?"
    )
    .get(hash) as SetupChallengeRow | undefined;
  if (!row) return null;
  if (row.used_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  const claimed = getDb()
    .prepare("UPDATE admin_setup_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL")
    .run(new Date().toISOString(), row.id);
  if (Number(claimed.changes) !== 1) return null;
  return row;
}

export async function setupFirstAdmin(input: SetupInput, ctx: Sessions.SessionContext): Promise<SetupResult> {
  assertSetupAllowed();
  if (countAdmins() > 0) {
    throw new AdminAuthError("SETUP_DISABLED", "An admin already exists; use login instead");
  }
  const email = normalizeEmail(input.email);
  const strength = validatePasswordStrength(input.password);
  if (!strength.ok) throw new AdminAuthError("WEAK_PASSWORD", strength.reason ?? "Invalid password");
  if (!input.displayName.trim()) throw new AdminAuthError("INVALID_DISPLAY_NAME", "Display name is required");

  const challenge = consumeSetupChallenge(input.setupChallenge);
  if (!challenge) {
    throw new AdminAuthError("SETUP_CHALLENGE_INVALID", "Setup challenge is missing, expired, or already used");
  }

  // Verify the TOTP against the just-issued secret before persisting anything.
  const ok = TOTP.verifyRaw(challenge.secret_base32, input.totpCode);
  if (!ok) {
    throw new AdminAuthError("INVALID_TOTP", "TOTP code did not validate against the new secret");
  }

  const userId = `adu_${randomUUID()}`;
  const now = new Date().toISOString();
  const { hash } = await hashPassword(input.password);

  const db = getDb();
  db.prepare("BEGIN IMMEDIATE").run();
  try {
    const existing = db.prepare("SELECT COUNT(*) AS n FROM admin_users").get() as { n: number };
    if (existing.n > 0) {
      throw new AdminAuthError("SETUP_DISABLED", "An admin already exists; use login instead");
    }
    const inserted = db
      .prepare(
        `INSERT INTO admin_users (id, email, display_name, password_hash, password_algo, is_disabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'argon2id', 0, ?, ?)`
      )
      .run(userId, email, input.displayName.trim(), hash, now, now);
    if (Number(inserted.changes) !== 1) throw new Error("Failed to insert admin user");

    // Persist the secret in encrypted form, with the just-verified counter at the current step.
    const encrypted = encryptSecret(challenge.secret_base32);
    const step = Math.floor(Date.now() / 1000 / 30);
    db.prepare(
      `INSERT INTO admin_totp_secrets (admin_user_id, secret_encrypted, enrolled_at, last_used_counter) VALUES (?, ?, ?, ?)`
    ).run(userId, encrypted, now, step);
  } catch (e) {
    db.prepare("ROLLBACK").run();
    throw e;
  }
  db.prepare("COMMIT").run();

  const codes = generateRecoveryCodes(userId);
  const session = Sessions.issueSession(userId, ctx);
  const user = findById(userId);
  if (!user) throw new AdminAuthError("INTERNAL", "Failed to read back the created admin user");
  return { user, session, recoveryCodes: codes };
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
  const lockState = RateLimit.isLockedOut(email, ctx.ipAddress);
  if (lockState.locked) {
    RateLimit.recordAttempt({ emailLower: email, ipAddress: ctx.ipAddress, succeeded: false, reason: "LOCKED_OUT" });
    throw new AdminAuthError("RATE_LIMITED", "Too many failed attempts; try again later");
  }
  const user = findByEmail(email);
  if (!user || user.is_disabled) {
    RateLimit.recordAttempt({ emailLower: email, ipAddress: ctx.ipAddress, succeeded: false, reason: "UNKNOWN_USER" });
    throw new AdminAuthError("INVALID_CREDENTIALS", "Invalid email or password");
  }
  const creds = getDb()
    .prepare("SELECT password_hash FROM admin_users WHERE id = ?")
    .get(user.id) as { password_hash: string } | undefined;
  if (!creds) {
    RateLimit.recordAttempt({ emailLower: email, ipAddress: ctx.ipAddress, succeeded: false, reason: "NO_CREDENTIALS" });
    throw new AdminAuthError("INVALID_CREDENTIALS", "Invalid email or password");
  }
  const ok = await verifyPassword(input.password, creds.password_hash);
  if (!ok) {
    RateLimit.recordAttempt({ emailLower: email, ipAddress: ctx.ipAddress, succeeded: false, reason: "BAD_PASSWORD" });
    throw new AdminAuthError("INVALID_CREDENTIALS", "Invalid email or password");
  }
  if (user.totp_enrolled) {
    const challenge = generateOpaqueToken().token;
    const expiresIn = 300;
    storeChallenge(challenge, user.id, expiresIn);
    return { kind: "mfa_required", challenge, expiresIn };
  }
  RateLimit.clearAttemptsForEmail(email);
  RateLimit.recordAttempt({ emailLower: email, ipAddress: ctx.ipAddress, succeeded: true });
  const session = Sessions.issueSession(user.id, ctx);
  return { kind: "authenticated", user, session };
}

interface ChallengeRow {
  admin_user_id: string;
  expires_at: string;
  used_at: string | null;
}

function storeChallenge(challenge: string, adminUserId: string, ttlSeconds: number): void {
  const hash = createHash("sha256").update(challenge).digest("hex");
  const id = `ach_${randomUUID()}`;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  getDb()
    .prepare(
      `CREATE TABLE IF NOT EXISTS admin_login_challenges (
         id TEXT PRIMARY KEY,
         token_hash TEXT UNIQUE NOT NULL,
         admin_user_id TEXT NOT NULL,
         expires_at TEXT NOT NULL,
         used_at TEXT,
         created_at TEXT NOT NULL
       )`
    )
    .run();
  getDb()
    .prepare(
      `INSERT INTO admin_login_challenges (id, token_hash, admin_user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, hash, adminUserId, expiresAt, new Date().toISOString());
}

function consumeChallenge(challenge: string): string | null {
  const hash = createHash("sha256").update(challenge).digest("hex");
  const row = getDb()
    .prepare("SELECT admin_user_id, expires_at, used_at FROM admin_login_challenges WHERE token_hash = ?")
    .get(hash) as ChallengeRow | undefined;
  if (!row) return null;
  if (row.used_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  getDb()
    .prepare("UPDATE admin_login_challenges SET used_at = ? WHERE token_hash = ? AND used_at IS NULL")
    .run(new Date().toISOString(), hash);
  return row.admin_user_id;
}

function invalidateAllChallengesForUser(adminUserId: string): void {
  getDb()
    .prepare("UPDATE admin_login_challenges SET used_at = ? WHERE admin_user_id = ? AND used_at IS NULL")
    .run(new Date().toISOString(), adminUserId);
}

export interface MfaResult {
  user: AdminUser;
  session: Sessions.IssuedSession;
}

export function verifyMfaTotp(challenge: string, totp: string, ctx: Sessions.SessionContext): MfaResult {
  const adminUserId = consumeChallenge(challenge);
  if (!adminUserId) {
    throw new AdminAuthError("CHALLENGE_INVALID", "MFA challenge is invalid or expired");
  }
  const user = findById(adminUserId);
  if (!user) throw new AdminAuthError("USER_NOT_FOUND", "Admin user not found");
  if (user.is_disabled) throw new AdminAuthError("USER_DISABLED", "User is disabled");
  const result = TOTP.verify(adminUserId, totp);
  if (!result.ok) {
    invalidateAllChallengesForUser(adminUserId);
    throw new AdminAuthError("INVALID_TOTP", result.reason ?? "Invalid TOTP code");
  }
  RateLimit.clearAttemptsForEmail(user.email);
  const session = Sessions.issueSession(user.id, ctx);
  return { user, session };
}

function generateRecoveryCodes(adminUserId: string): string[] {
  const db = getDb();
  const ids: string[] = [];
  const codes: string[] = [];
  db.prepare("BEGIN").run();
  try {
    // Invalidate all existing unused codes (this is the rotation moment).
    db.prepare("UPDATE admin_recovery_codes SET used_at = ? WHERE admin_user_id = ? AND used_at IS NULL").run(
      new Date().toISOString(),
      adminUserId
    );
    for (let i = 0; i < 10; i++) {
      const code = formatRecoveryCode(randomBytes(8));
      const id = `arc_${randomUUID()}`;
      const hash = sha256Normalize(code);
      db.prepare(
        "INSERT INTO admin_recovery_codes (id, admin_user_id, code_hash, used_at, created_at) VALUES (?, ?, ?, NULL, ?)"
      ).run(id, adminUserId, hash, new Date().toISOString());
      ids.push(id);
      codes.push(code);
    }
  } catch (e) {
    db.prepare("ROLLBACK").run();
    throw e;
  }
  db.prepare("COMMIT").run();
  return codes;
}

// Crockford-base32-like alphabet (no I, L, O, U, 0, 1) for human-readable codes.
const RECOVERY_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

function formatRecoveryCode(bytes: Buffer): string {
  // Convert 8 bytes (64 bits) to 13 base-32-ish chars then take first 10.
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

export interface RecoveryResult {
  user: AdminUser;
  session: Sessions.IssuedSession;
  newRecoveryCodes: string[];
}

export function verifyMfaRecovery(challenge: string, recoveryCode: string, ctx: Sessions.SessionContext): RecoveryResult {
  const adminUserId = consumeChallenge(challenge);
  if (!adminUserId) {
    throw new AdminAuthError("CHALLENGE_INVALID", "MFA challenge is invalid or expired");
  }
  const user = findById(adminUserId);
  if (!user) throw new AdminAuthError("USER_NOT_FOUND", "Admin user not found");
  if (user.is_disabled) throw new AdminAuthError("USER_DISABLED", "User is disabled");
  const normalized = normalizeRecoveryCode(recoveryCode);
  if (normalized.length < 8 || normalized.length > 16) {
    invalidateAllChallengesForUser(adminUserId);
    throw new AdminAuthError("INVALID_RECOVERY", "Recovery code is the wrong shape");
  }
  const hash = sha256Normalize(normalized);
  const row = getDb()
    .prepare("SELECT id FROM admin_recovery_codes WHERE admin_user_id = ? AND code_hash = ? AND used_at IS NULL")
    .get(adminUserId, hash) as { id: string } | undefined;
  if (!row) {
    invalidateAllChallengesForUser(adminUserId);
    throw new AdminAuthError("INVALID_RECOVERY", "Recovery code is invalid or already used");
  }
  getDb()
    .prepare("UPDATE admin_recovery_codes SET used_at = ? WHERE id = ?")
    .run(new Date().toISOString(), row.id);
  // Rotate the entire batch: invalidate all remaining and generate 10 new ones.
  getDb()
    .prepare("UPDATE admin_recovery_codes SET used_at = ? WHERE admin_user_id = ? AND used_at IS NULL")
    .run(new Date().toISOString(), adminUserId);
  const newCodes = generateRecoveryCodes(adminUserId);
  RateLimit.clearAttemptsForEmail(user.email);
  const session = Sessions.issueSession(user.id, ctx);
  return { user, session, newRecoveryCodes: newCodes };
}

export function meFromSession(rawToken: string | null): AdminUser | null {
  if (!rawToken) return null;
  const resolved = Sessions.resolveSession(rawToken);
  if (!resolved) return null;
  const user = findById(resolved.adminUserId);
  if (!user) return null;
  Sessions.touchSession(resolved.sessionId);
  return user;
}

export function logout(rawToken: string): boolean {
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
