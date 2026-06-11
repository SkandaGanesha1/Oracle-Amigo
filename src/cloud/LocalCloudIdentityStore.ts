import type { DatabaseSync } from "node:sqlite";
import { getDb } from "../db/connection.js";

export interface LocalCloudIdentity {
  profileId: string;
  controlPlaneUrl: string;
  orgId: string | null;
  userId: string | null;
  userEmail: string | null;
  displayName: string | null;
  deviceId: string | null;
  agentId: string | null;
  agentInstanceId: string | null;
  relayInboxUrl: string | null;
  userAccessToken: string | null;
  deviceAccessToken: string | null;
  refreshToken: string | null;
  userRefreshToken: string | null;
  deviceRefreshToken: string | null;
  status: "disconnected" | "authenticated" | "enrolled";
  createdAt: string;
  updatedAt: string;
}

export interface LocalCloudIdentityPatch {
  controlPlaneUrl?: string;
  orgId?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  displayName?: string | null;
  deviceId?: string | null;
  agentId?: string | null;
  agentInstanceId?: string | null;
  relayInboxUrl?: string | null;
  userAccessToken?: string | null;
  deviceAccessToken?: string | null;
  refreshToken?: string | null;
  userRefreshToken?: string | null;
  deviceRefreshToken?: string | null;
  status?: LocalCloudIdentity["status"];
}

export function defaultProfileId(): string {
  return process.env.AGENTIC_PROFILE_ID?.trim() || "default";
}

export function defaultControlPlaneUrl(): string {
  return process.env.CONTROL_PLANE_URL?.trim() || "http://127.0.0.1:8080";
}

export class LocalCloudIdentityStore {
  constructor(private db: DatabaseSync = getDb()) {}

  get(profileId = defaultProfileId()): LocalCloudIdentity | null {
    const row = this.db.prepare("SELECT * FROM local_cloud_identity WHERE profile_id = ?").get(profileId) as
      Record<string, unknown> | undefined;
    return row ? rowToIdentity(row) : null;
  }

  getOrCreate(profileId = defaultProfileId(), controlPlaneUrl = defaultControlPlaneUrl()): LocalCloudIdentity {
    const existing = this.get(profileId);
    if (existing) return existing;
    return this.save(profileId, { controlPlaneUrl, status: "disconnected" });
  }

  save(profileId: string, patch: LocalCloudIdentityPatch): LocalCloudIdentity {
    const existing = this.get(profileId);
    const now = new Date().toISOString();
    const next = {
      profileId,
      controlPlaneUrl: pick(patch, "controlPlaneUrl", existing?.controlPlaneUrl ?? defaultControlPlaneUrl()),
      orgId: pick(patch, "orgId", existing?.orgId ?? null),
      userId: pick(patch, "userId", existing?.userId ?? null),
      userEmail: pick(patch, "userEmail", existing?.userEmail ?? null),
      displayName: pick(patch, "displayName", existing?.displayName ?? null),
      deviceId: pick(patch, "deviceId", existing?.deviceId ?? null),
      agentId: pick(patch, "agentId", existing?.agentId ?? null),
      agentInstanceId: pick(patch, "agentInstanceId", existing?.agentInstanceId ?? null),
      relayInboxUrl: pick(patch, "relayInboxUrl", existing?.relayInboxUrl ?? null),
      userAccessToken: pick(patch, "userAccessToken", existing?.userAccessToken ?? null),
      deviceAccessToken: pick(patch, "deviceAccessToken", existing?.deviceAccessToken ?? null),
      refreshToken: pick(patch, "refreshToken", existing?.refreshToken ?? null),
      userRefreshToken: pick(patch, "userRefreshToken", existing?.userRefreshToken ?? null),
      deviceRefreshToken: pick(patch, "deviceRefreshToken", existing?.deviceRefreshToken ?? null),
      status: pick(patch, "status", existing?.status ?? "disconnected"),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    this.db.prepare(`
      INSERT INTO local_cloud_identity
        (profile_id, control_plane_url, org_id, user_id, user_email, display_name,
         device_id, agent_id, agent_instance_id, relay_inbox_url, user_access_token,
         device_access_token, refresh_token, user_refresh_token, device_refresh_token,
         status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET
        control_plane_url=excluded.control_plane_url,
        org_id=excluded.org_id,
        user_id=excluded.user_id,
        user_email=excluded.user_email,
        display_name=excluded.display_name,
        device_id=excluded.device_id,
        agent_id=excluded.agent_id,
        agent_instance_id=excluded.agent_instance_id,
        relay_inbox_url=excluded.relay_inbox_url,
        user_access_token=excluded.user_access_token,
        device_access_token=excluded.device_access_token,
        refresh_token=excluded.refresh_token,
        user_refresh_token=excluded.user_refresh_token,
        device_refresh_token=excluded.device_refresh_token,
        status=excluded.status,
        updated_at=excluded.updated_at
    `).run(
      next.profileId,
      next.controlPlaneUrl,
      next.orgId,
      next.userId,
      next.userEmail,
      next.displayName,
      next.deviceId,
      next.agentId,
      next.agentInstanceId,
      next.relayInboxUrl,
      next.userAccessToken,
      next.deviceAccessToken,
      next.refreshToken,
      next.userRefreshToken,
      next.deviceRefreshToken,
      next.status,
      next.createdAt,
      next.updatedAt
    );
    return this.get(profileId)!;
  }

  clearTokens(profileId = defaultProfileId()): LocalCloudIdentity {
    return this.save(profileId, {
      userAccessToken: null,
      deviceAccessToken: null,
      refreshToken: null,
      userRefreshToken: null,
      deviceRefreshToken: null,
      status: "disconnected"
    });
  }
}

function rowToIdentity(row: Record<string, unknown>): LocalCloudIdentity {
  return {
    profileId: String(row.profile_id),
    controlPlaneUrl: String(row.control_plane_url),
    orgId: nullable(row.org_id),
    userId: nullable(row.user_id),
    userEmail: nullable(row.user_email),
    displayName: nullable(row.display_name),
    deviceId: nullable(row.device_id),
    agentId: nullable(row.agent_id),
    agentInstanceId: nullable(row.agent_instance_id),
    relayInboxUrl: nullable(row.relay_inbox_url),
    userAccessToken: nullable(row.user_access_token),
    deviceAccessToken: nullable(row.device_access_token),
    refreshToken: nullable(row.refresh_token),
    userRefreshToken: nullable(row.user_refresh_token) ?? nullable(row.refresh_token),
    deviceRefreshToken: nullable(row.device_refresh_token),
    status: String(row.status) as LocalCloudIdentity["status"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function nullable(value: unknown): string | null {
  return value == null ? null : String(value);
}

function pick<K extends keyof LocalCloudIdentityPatch>(
  patch: LocalCloudIdentityPatch,
  key: K,
  fallback: NonNullable<LocalCloudIdentityPatch[K]> | null
): NonNullable<LocalCloudIdentityPatch[K]> | null {
  return Object.prototype.hasOwnProperty.call(patch, key)
    ? ((patch[key] ?? null) as NonNullable<LocalCloudIdentityPatch[K]> | null)
    : fallback;
}
