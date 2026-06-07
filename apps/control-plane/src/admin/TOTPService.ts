import * as OTPAuth from "otpauth";
import { getDb } from "../db/connection.js";
import { decryptSecret, encryptSecret } from "./AdminCrypto.js";

const ISSUER = "Oracle Amigo";
const PERIOD = 30;
const DIGITS = 6;
const ALGO = "SHA1";
const SECRET_BYTES = 20;

export function generateSecret(): { base32: string; otpauthUri: string } {
  const secret = new OTPAuth.Secret({ size: SECRET_BYTES });
  return {
    base32: secret.base32,
    otpauthUri: buildProvisioningUri(secret)
  };
}

export function buildProvisioningUri(secret: OTPAuth.Secret, accountLabel?: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: accountLabel ?? ISSUER,
    algorithm: ALGO,
    digits: DIGITS,
    period: PERIOD,
    secret
  });
  return totp.toString();
}

interface TotpRow {
  admin_user_id: string;
  secret_encrypted: string;
  last_used_counter: number;
}

function loadTotpRow(adminUserId: string): TotpRow | undefined {
  const db = getDb();
  return db
    .prepare("SELECT admin_user_id, secret_encrypted, last_used_counter FROM admin_totp_secrets WHERE admin_user_id = ?")
    .get(adminUserId) as TotpRow | undefined;
}

export function isEnrolled(adminUserId: string): boolean {
  return loadTotpRow(adminUserId) !== undefined;
}

export function enroll(adminUserId: string, base32Secret: string, currentTotp: string): boolean {
  // Verify the first TOTP before persisting — this prevents storing a secret the user mistyped.
  if (!verifyAny(adminUserId, currentTotp)) {
    // No row exists yet, so we must verify without monotonic-counter check.
    if (!verifyRaw(base32Secret, currentTotp)) return false;
  }
  const db = getDb();
  const secret = OTPAuth.Secret.fromBase32(base32Secret);
  const encrypted = encryptSecret(secret.base32);
  const now = new Date().toISOString();
  const existing = loadTotpRow(adminUserId);
  if (existing) {
    db.prepare(
      "UPDATE admin_totp_secrets SET secret_encrypted = ?, enrolled_at = ?, last_used_counter = 0 WHERE admin_user_id = ?"
    ).run(encrypted, now, adminUserId);
  } else {
    db.prepare(
      "INSERT INTO admin_totp_secrets (admin_user_id, secret_encrypted, enrolled_at, last_used_counter) VALUES (?, ?, ?, 0)"
    ).run(adminUserId, encrypted, now);
  }
  return true;
}

export function verify(adminUserId: string, totp: string): { ok: boolean; reason?: string } {
  const result = verifyAny(adminUserId, totp);
  if (!result.ok) return result;
  bumpCounter(adminUserId, result.delta ?? 0);
  return { ok: true };
}

interface VerifyResult {
  ok: boolean;
  delta?: number;
  reason?: string;
}

function verifyAny(adminUserId: string, totp: string): VerifyResult {
  const row = loadTotpRow(adminUserId);
  if (!row) return { ok: false, reason: "TOTP_NOT_ENROLLED" };
  const base32 = decryptSecret(row.secret_encrypted);
  const secret = OTPAuth.Secret.fromBase32(base32);
  const totpObj = new OTPAuth.TOTP({
    issuer: ISSUER,
    algorithm: ALGO,
    digits: DIGITS,
    period: PERIOD,
    secret
  });
  // Window of 1 step (±30s) tolerates small clock drift but blocks replay.
  const delta = totpObj.validate({ token: normalize(totp), window: 1 });
  if (delta === null) return { ok: false, reason: "INVALID_TOTP" };
  // delta is the offset of the matched step. Reject if we've already used that step.
  // We store last_used_counter as the highest step ever accepted; any smaller step is a replay.
  const step = Math.floor(Date.now() / 1000 / PERIOD) + delta;
  if (step <= row.last_used_counter) {
    return { ok: false, reason: "TOTP_REPLAY" };
  }
  return { ok: true, delta };
}

export function verifyRaw(base32: string, totp: string): boolean {
  const secret = OTPAuth.Secret.fromBase32(base32);
  const totpObj = new OTPAuth.TOTP({
    issuer: ISSUER,
    algorithm: ALGO,
    digits: DIGITS,
    period: PERIOD,
    secret
  });
  return totpObj.validate({ token: normalize(totp), window: 1 }) !== null;
}

function bumpCounter(adminUserId: string, delta: number): void {
  const step = Math.floor(Date.now() / 1000 / PERIOD) + delta;
  getDb()
    .prepare("UPDATE admin_totp_secrets SET last_used_counter = MAX(last_used_counter, ?) WHERE admin_user_id = ?")
    .run(step, adminUserId);
}

function normalize(input: string): string {
  return input.replace(/[\s-]/g, "").trim();
}
