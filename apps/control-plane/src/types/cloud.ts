export type OrgId = string;
export type UserId = string;
export type DeviceId = string;
export type AgentId = string;
export type AgentInstanceId = string;
export type RefreshTokenId = string;
export type DeviceTokenId = string;
export type RelayTaskId = string;
export type RelayMessageId = string;
export type TransferId = string;
export type AuditEventId = string;
export type ContactId = string;

export type UserStatus = "active" | "disabled" | "pending";
export type DeviceStatus = "active" | "disabled" | "revoked";
export type AgentStatus = "active" | "disabled";
export type AgentInstanceStatus = "active" | "disabled" | "revoked";
export type ContactStatus = "pending" | "accepted" | "blocked" | "declined";
export type PresenceStatus = "online" | "stale" | "offline" | "revoked";
export type RelayTaskStatus = "pending" | "delivered" | "completed" | "cancelled" | "expired";
export type RelayMessageStatus = "pending" | "delivered" | "acked" | "responded" | "expired";
export type TransferStatus = "initialized" | "uploading" | "ready" | "downloading" | "completed" | "expired" | "failed";

export interface Organization {
  id: OrgId;
  name: string;
  slug: string;
  createdAt: string;
}

export interface User {
  id: UserId;
  orgId: OrgId;
  email: string;
  displayName: string;
  status: UserStatus;
  createdAt: string;
}

export interface Device {
  id: DeviceId;
  orgId: OrgId;
  userId: UserId;
  deviceName: string;
  os: string | null;
  osVersion: string | null;
  publicKey: string;
  publicKeyFingerprint: string;
  did: string | null;
  status: DeviceStatus;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface Agent {
  id: AgentId;
  orgId: OrgId;
  ownerUserId: UserId;
  displayName: string;
  status: AgentStatus;
  createdAt: string;
}

export interface AgentInstance {
  id: AgentInstanceId;
  orgId: OrgId;
  agentId: AgentId;
  deviceId: DeviceId;
  userId: UserId;
  agentCardJson: string;
  agentCardHash: string;
  relayInboxId: string;
  version: string | null;
  status: AgentInstanceStatus;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface Contact {
  id: ContactId;
  orgId: OrgId;
  requesterUserId: UserId;
  targetUserId: UserId;
  status: ContactStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Presence {
  agentInstanceId: AgentInstanceId;
  orgId: OrgId;
  userId: UserId;
  agentId: AgentId;
  deviceId: DeviceId;
  status: PresenceStatus;
  lastHeartbeatAt: string;
  currentVersion: string | null;
  capabilitiesJson: string | null;
  agentCardHash: string | null;
  localQueueDepth: number;
}

export interface RelayTask {
  id: RelayTaskId;
  orgId: OrgId;
  fromAgentInstanceId: AgentInstanceId;
  toAgentInstanceId: AgentInstanceId;
  a2aTaskId: string;
  type: string;
  payloadJson: string;
  status: RelayTaskStatus;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
  completedAt: string | null;
}

export interface RelayMessage {
  id: RelayMessageId;
  orgId: OrgId;
  relayTaskId: RelayTaskId | null;
  fromAgentInstanceId: AgentInstanceId;
  toAgentInstanceId: AgentInstanceId;
  payloadJson: string;
  status: RelayMessageStatus;
  idempotencyKey: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface FileTransfer {
  id: TransferId;
  orgId: OrgId;
  relayTaskId: RelayTaskId | null;
  fromAgentInstanceId: AgentInstanceId;
  toAgentInstanceId: AgentInstanceId;
  fileName: string;
  fileSize: number;
  sha256: string;
  storagePath: string;
  encryptionKeyId: string | null;
  encryptionAlgo: string | null;
  status: TransferStatus;
  expiresAt: string;
  createdAt: string;
  completedAt: string | null;
}

export interface AuditEvent {
  id: AuditEventId;
  orgId: OrgId;
  actorUserId: UserId | null;
  actorAgentInstanceId: AgentInstanceId | null;
  eventType: string;
  detailsJson: string;
  previousHash: string | null;
  eventHash: string | null;
  createdAt: string;
}

export interface AccessTokenClaims {
  sub: UserId;
  org: OrgId;
  scope: string;
  iat: number;
  exp: number;
  iss: string;
  email: string;
  display_name: string;
}

export interface DeviceTokenClaims {
  sub: AgentInstanceId;
  org: OrgId;
  user: UserId;
  device: DeviceId;
  agent: AgentId;
  iat: number;
  exp: number;
  iss: string;
  scope: "device";
}

export interface AuthContext {
  orgId: OrgId;
  userId: UserId;
  email: string;
  displayName: string;
  scope: string;
}

export interface DeviceAuthContext {
  orgId: OrgId;
  userId: UserId;
  deviceId: DeviceId;
  agentId: AgentId;
  agentInstanceId: AgentInstanceId;
  scope: "device";
}
