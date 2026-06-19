import { getControlPlaneStore } from "../db/connection.js";
import { loadConfig } from "../config.js";

export interface AttemptInput {
  emailLower: string;
  ipAddress: string | null;
  succeeded: boolean;
  reason?: string;
}

export async function recordAttempt(input: AttemptInput): Promise<void> {
  await getControlPlaneStore().execute(
      `INSERT INTO admin_login_attempts (email_lower, ip_address, succeeded, reason, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
    [
      input.emailLower,
      input.ipAddress,
      input.succeeded,
      input.reason ?? null,
      new Date().toISOString()
    ]
  );
}

export async function isLockedOut(emailLower: string, ipAddress: string | null): Promise<{ locked: boolean; until?: string }> {
  const cfg = loadConfig();
  const windowMs = cfg.ADMIN_LOGIN_LOCKOUT_MINUTES * 60_000;
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  const row = await getControlPlaneStore().one<{ last_attempt_at: string | null; fail_count: number | null }>(
      `SELECT MAX(created_at) AS last_attempt_at, COUNT(*) AS fail_count
       FROM admin_login_attempts
       WHERE created_at >= $1 AND email_lower = $2 AND succeeded = FALSE`,
    [cutoff, emailLower]
  );
  const fails = row?.fail_count ?? 0;
  if (fails >= cfg.ADMIN_LOGIN_RATELIMIT_PER_EMAIL) {
    return { locked: true, until: row?.last_attempt_at ?? undefined };
  }
  if (ipAddress) {
    const ipRow = await getControlPlaneStore().one<{ last_attempt_at: string | null; fail_count: number | null }>(
        `SELECT MAX(created_at) AS last_attempt_at, COUNT(*) AS fail_count
         FROM admin_login_attempts
         WHERE created_at >= $1 AND ip_address = $2 AND succeeded = FALSE`,
      [cutoff, ipAddress]
    );
    const ipFails = ipRow?.fail_count ?? 0;
    if (ipFails >= cfg.ADMIN_LOGIN_RATELIMIT_PER_IP) {
      return { locked: true, until: ipRow?.last_attempt_at ?? undefined };
    }
  }
  return { locked: false };
}

export async function clearAttemptsForEmail(emailLower: string): Promise<void> {
  await getControlPlaneStore().execute(
    "DELETE FROM admin_login_attempts WHERE email_lower = $1 AND succeeded = FALSE",
    [emailLower]
  );
}
