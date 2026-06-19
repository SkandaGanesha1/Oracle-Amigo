import * as OTPAuth from "otpauth";
import { getControlPlaneStore } from "../db/connection.js";
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

async function loadTotpRow(adminUserId: string): Promise<TotpRow | undefined> {
  return getControlPlaneStore().one<TotpRow & Record<string, unknown>>(
    "SELECT admin_user_id, secret_encrypted, last_used_counter FROM admin_totp_secrets WHERE admin_user_id = $1",
    [adminUserId]
  );
}

export async function isEnrolled(adminUserId: string): Promise<boolean> {
  return (await loadTotpRow(adminUserId)) !== undefined;
}

export async function enroll(adminUserId: string, base32Secret: string, currentTotp: string): Promise<boolean> {
  const verified = await verifyAny(adminUserId, currentTotp);
  if (!verified.ok && !verifyRaw(base32Secret, currentTotp)) return false;

  const secret = OTPAuth.Secret.fromBase32(base32Secret);
  const encrypted = encryptSecret(secret.base32);
  const now = new Date().toISOString();
  const existing = await loadTotpRow(adminUserId);
  if (existing) {
    await getControlPlaneStore().execute(
      "UPDATE admin_totp_secrets SET secret_encrypted = $1, enrolled_at = $2, last_used_counter = 0 WHERE admin_user_id = $3",
      [encrypted, now, adminUserId]
    );
  } else {
    await getControlPlaneStore().execute(
      "INSERT INTO admin_totp_secrets (admin_user_id, secret_encrypted, enrolled_at, last_used_counter) VALUES ($1, $2, $3, 0)",
      [adminUserId, encrypted, now]
    );
  }
  return true;
}

export async function verify(adminUserId: string, totp: string): Promise<{ ok: boolean; reason?: string }> {
  const result = await verifyAny(adminUserId, totp);
  if (!result.ok) return result;
  await bumpCounter(adminUserId, result.delta ?? 0);
  return { ok: true };
}

interface VerifyResult {
  ok: boolean;
  delta?: number;
  reason?: string;
}

async function verifyAny(adminUserId: string, totp: string): Promise<VerifyResult> {
  const row = await loadTotpRow(adminUserId);
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
  const delta = totpObj.validate({ token: normalize(totp), window: 1 });
  if (delta === null) return { ok: false, reason: "INVALID_TOTP" };
  const step = Math.floor(Date.now() / 1000 / PERIOD) + delta;
  if (step <= Number(row.last_used_counter)) {
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

async function bumpCounter(adminUserId: string, delta: number): Promise<void> {
  const step = Math.floor(Date.now() / 1000 / PERIOD) + delta;
  await getControlPlaneStore().execute(
    "UPDATE admin_totp_secrets SET last_used_counter = CASE WHEN last_used_counter < $1 THEN $1 ELSE last_used_counter END WHERE admin_user_id = $2",
    [step, adminUserId]
  );
}

function normalize(input: string): string {
  return input.replace(/[\s-]/g, "").trim();
}
