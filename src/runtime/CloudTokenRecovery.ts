import { createHash } from "node:crypto";
import { CloudError } from "../cloud/ControlPlaneClient.js";
import { LocalCloudIdentityStore, defaultProfileId, type LocalCloudIdentity } from "../cloud/LocalCloudIdentityStore.js";
import { AgentRegistrationService } from "../enrollment/AgentRegistrationService.js";
import { generateOrLoadIdentity } from "../security/DeviceIdentity.js";
import { resolveDbPath } from "../db/connection.js";

export type DeviceTokenIssue = "expired" | null;

export interface DeviceTokenRecoveryStatus {
  tokenIssue: DeviceTokenIssue;
  canRecoverDeviceToken: boolean;
  localPublicKeyFingerprint: string | null;
}

let recoveryPromise: Promise<LocalCloudIdentity> | null = null;

export function isDeviceTokenExpiredError(error: unknown): boolean {
  if (error instanceof CloudError) {
    return (
      error.statusCode === 401 &&
      (error.code === "DEVICE_TOKEN_EXPIRED" ||
        error.code === "TOKEN_EXPIRED" ||
        /jwt expired|token.*expired|expired/i.test(error.message))
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return /jwt expired|device_token_expired|token_expired|token.*expired/i.test(message);
}

export function isDeviceKeyOwnedByOtherUser(error: unknown): boolean {
  if (error instanceof CloudError) {
    return /Device public key already enrolled by another user/i.test(error.message);
  }
  const message = error instanceof Error ? error.message : String(error);
  return /Device public key already enrolled by another user/i.test(message);
}

export async function recoverDeviceToken(
  store = new LocalCloudIdentityStore(),
  profileId = defaultProfileId()
): Promise<LocalCloudIdentity> {
  if (!recoveryPromise) {
    recoveryPromise = new AgentRegistrationService(store).enroll({ profileId })
      .then(() => {
        const identity = store.get(profileId);
        if (!identity?.deviceAccessToken || !identity.agentInstanceId) {
          throw new Error("Device token recovery did not produce an enrolled cloud identity");
        }
        return identity;
      })
      .finally(() => {
        recoveryPromise = null;
      });
  }
  return recoveryPromise;
}

export async function withRecoveredDeviceToken<T>(
  store: LocalCloudIdentityStore,
  profileId: string,
  operation: (identity: LocalCloudIdentity) => Promise<T>
): Promise<T> {
  const identity = store.get(profileId);
  if (!identity?.deviceAccessToken || !identity.agentInstanceId) {
    throw new Error("Cloud enrollment is required before this operation");
  }
  try {
    return await operation(identity);
  } catch (error) {
    if (!isDeviceTokenExpiredError(error)) throw error;
    const recovered = await recoverDeviceToken(store, profileId);
    return operation(recovered);
  }
}

export function getDeviceTokenRecoveryStatus(identity: LocalCloudIdentity | null): DeviceTokenRecoveryStatus {
  const tokenIssue = identity?.deviceAccessToken && isExpiredJwt(identity.deviceAccessToken) ? "expired" : null;
  const localIdentity = generateOrLoadIdentity(identity?.displayName ?? "Local User", resolveDbPath());
  return {
    tokenIssue,
    canRecoverDeviceToken: Boolean(identity?.userRefreshToken ?? identity?.refreshToken),
    localPublicKeyFingerprint: fingerprint(localIdentity.publicKey)
  };
}

export function structuredEnrollmentError(error: unknown, identity: LocalCloudIdentity | null): Record<string, unknown> | null {
  if (!isDeviceKeyOwnedByOtherUser(error)) return null;
  const localIdentity = generateOrLoadIdentity(identity?.displayName ?? "Local User", resolveDbPath());
  return {
    error: "DEVICE_KEY_OWNED_BY_OTHER_USER",
    message: "Device public key already enrolled by another user",
    recovery: {
      canResetLocalDeviceIdentity: Boolean(identity?.userAccessToken),
      accountEmail: identity?.userEmail ?? null,
      controlPlaneUrl: identity?.controlPlaneUrl ?? null,
      localPublicKeyFingerprint: fingerprint(localIdentity.publicKey)
    }
  };
}

export function isExpiredJwt(token: string): boolean {
  const parts = token.split(".");
  if (parts.length < 2) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" && payload.exp * 1000 <= Date.now();
  } catch {
    return false;
  }
}

function fingerprint(publicKey: string): string {
  return createHash("sha256").update(publicKey.trim().toLowerCase()).digest("hex").slice(0, 16);
}
