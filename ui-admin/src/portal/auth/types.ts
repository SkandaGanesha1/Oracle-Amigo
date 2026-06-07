export interface AdminSessionUser {
  id: string;
  email: string;
  display_name: string;
  totp_enrolled: boolean;
  is_disabled: boolean;
  created_at: string;
}

export interface SetupStatus {
  required: boolean;
  has_any_admin: boolean;
}

export interface LoginResponse {
  status: "ok";
  user: AdminSessionUser;
}

export interface MfaRequiredResponse {
  status: "mfa_required";
  challenge: string;
  expires_in: number;
}

export interface SetupStartResponse {
  challenge: string;
  provisioning_uri: string;
  secret_base32: string;
  expires_in: number;
}

export interface SetupCompleteResponse {
  user: AdminSessionUser;
  recovery_codes: string[];
}

export interface RecoveryVerifyResponse {
  user: AdminSessionUser;
  recovery_codes: string[];
}

export type LoginApiResult = LoginResponse | MfaRequiredResponse;

export function isMfaRequired(value: unknown): value is MfaRequiredResponse {
  return !!value && typeof value === "object" && (value as { status?: string }).status === "mfa_required";
}
