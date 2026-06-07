import { adminFetch } from "../api/client";
import type {
  AdminSessionUser,
  LoginApiResult,
  LoginResponse,
  RecoveryVerifyResponse,
  SetupCompleteResponse,
  SetupStartResponse,
  SetupStatus
} from "./types";

export function fetchSetupStatus(signal?: AbortSignal): Promise<SetupStatus> {
  return adminFetch<SetupStatus>("/v1/admin/auth/setup-status", { signal });
}

export function fetchMe(signal?: AbortSignal): Promise<{ user: AdminSessionUser }> {
  return adminFetch<{ user: AdminSessionUser }>("/v1/admin/auth/me", { signal });
}

export function startSetup(): Promise<SetupStartResponse> {
  return adminFetch<SetupStartResponse>("/v1/admin/auth/setup/start", { method: "POST", body: {} });
}

export function loginStep1(email: string, password: string): Promise<LoginApiResult> {
  return adminFetch<LoginApiResult>("/v1/admin/auth/login", {
    method: "POST",
    body: { email, password }
  });
}

export function verifyMfaTotp(
  challenge: string,
  code: string
): Promise<LoginResponse> {
  return adminFetch<LoginResponse>("/v1/admin/auth/mfa/verify", {
    method: "POST",
    body: { challenge, totp_code: code }
  });
}

export function verifyMfaRecovery(
  challenge: string,
  code: string
): Promise<RecoveryVerifyResponse> {
  return adminFetch<RecoveryVerifyResponse>("/v1/admin/auth/mfa/recovery", {
    method: "POST",
    body: { challenge, recovery_code: code }
  });
}

export function setupFirstAdmin(input: {
  email: string;
  display_name: string;
  password: string;
  totp_code: string;
  setup_challenge: string;
}): Promise<SetupCompleteResponse> {
  return adminFetch<SetupCompleteResponse>("/v1/admin/auth/setup", {
    method: "POST",
    body: input
  });
}

export function logout(): Promise<void> {
  return adminFetch<void>("/v1/admin/auth/logout", { method: "POST" });
}
