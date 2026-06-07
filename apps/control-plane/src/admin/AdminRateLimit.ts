import { getDb } from "../db/connection.js";
import { loadConfig } from "../config.js";

export interface AttemptInput {
  emailLower: string;
  ipAddress: string | null;
  succeeded: boolean;
  reason?: string;
}

export function recordAttempt(input: AttemptInput): void {
  getDb()
    .prepare(
      `INSERT INTO admin_login_attempts (email_lower, ip_address, succeeded, reason, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      input.emailLower,
      input.ipAddress,
      input.succeeded ? 1 : 0,
      input.reason ?? null,
      new Date().toISOString()
    );
}

export function isLockedOut(emailLower: string, ipAddress: string | null): { locked: boolean; until?: string } {
  const cfg = loadConfig();
  const windowMs = cfg.ADMIN_LOGIN_LOCKOUT_MINUTES * 60_000;
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  const row = getDb()
    .prepare(
      `SELECT MAX(created_at) AS last_attempt_at, SUM(succeeded) AS success_count, COUNT(*) AS fail_count
       FROM admin_login_attempts
       WHERE created_at >= ? AND email_lower = ? AND succeeded = 0`
    )
    .get(cutoff, emailLower) as { last_attempt_at: string | null; success_count: number | null; fail_count: number | null } | undefined;
  const fails = row?.fail_count ?? 0;
  if (fails >= cfg.ADMIN_LOGIN_RATELIMIT_PER_EMAIL) {
    return { locked: true, until: row?.last_attempt_at ?? undefined };
  }
  if (ipAddress) {
    const ipRow = getDb()
      .prepare(
        `SELECT MAX(created_at) AS last_attempt_at, COUNT(*) AS fail_count
         FROM admin_login_attempts
         WHERE created_at >= ? AND ip_address = ? AND succeeded = 0`
      )
      .get(cutoff, ipAddress) as { last_attempt_at: string | null; fail_count: number | null } | undefined;
    const ipFails = ipRow?.fail_count ?? 0;
    if (ipFails >= cfg.ADMIN_LOGIN_RATELIMIT_PER_IP) {
      return { locked: true, until: ipRow?.last_attempt_at ?? undefined };
    }
  }
  return { locked: false };
}

export function clearAttemptsForEmail(emailLower: string): void {
  getDb()
    .prepare("DELETE FROM admin_login_attempts WHERE email_lower = ? AND succeeded = 0")
    .run(emailLower);
}
