import { ControlPlaneClient } from "../cloud/ControlPlaneClient.js";
import { DirectoryClient, type CloudAgentInstance, type CloudAgentInstanceDirectoryEntry, type CloudUserAgents } from "../cloud/DirectoryClient.js";
import { defaultProfileId, LocalCloudIdentityStore, type LocalCloudIdentity } from "../cloud/LocalCloudIdentityStore.js";
import { ChatRepository, type ChatConversationRecord } from "../chat/ChatRepository.js";
import type { DeviceEnrollmentService } from "../enrollment/DeviceEnrollmentService.js";

export interface PeerTargetResolution {
  agentInstanceId: string | null;
  userId: string | null;
  displayName: string | null;
  email: string | null;
  presence: string;
  reason: "user_agents" | "agent_instance" | "fallback" | "unresolved";
}

interface DirectoryAuthContext {
  client: DirectoryClient;
  userToken: string | null;
  deviceToken: string | null;
}

export class PeerRoutingService {
  constructor(
    private chatRepo: ChatRepository,
    private opts: {
      identityStore?: LocalCloudIdentityStore;
      enrollmentService?: DeviceEnrollmentService;
      profileId?: string;
    } = {}
  ) {}

  async refreshConversationPeer(
    conversation: ChatConversationRecord,
    input: { cloud?: LocalCloudIdentity | null; capability?: string } = {}
  ): Promise<ChatConversationRecord> {
    if (conversation.mode !== "cloud_relay") return conversation;
    const target = await this.resolveTarget({
      peerUserId: conversation.peer_user_id,
      peerAgentInstanceId: conversation.peer_agent_instance_id,
      title: conversation.title,
      cloud: input.cloud,
      capability: input.capability
    });
    if (!target.agentInstanceId && !target.userId && !target.displayName) return conversation;

    const shouldUpdate =
      (target.userId && target.userId !== conversation.peer_user_id) ||
      (target.agentInstanceId && target.agentInstanceId !== conversation.peer_agent_instance_id) ||
      (target.displayName && target.displayName !== conversation.title);

    if (!shouldUpdate) return conversation;
    return this.chatRepo.updateConversationPeer(conversation.id, {
      peerUserId: target.userId ?? conversation.peer_user_id,
      peerAgentInstanceId: target.agentInstanceId ?? conversation.peer_agent_instance_id,
      title: target.displayName ?? conversation.title
    }) ?? conversation;
  }

  async resolveTarget(input: {
    peerUserId?: string | null;
    peerAgentInstanceId?: string | null;
    title?: string | null;
    capability?: string;
    cloud?: LocalCloudIdentity | null;
  }): Promise<PeerTargetResolution> {
    const cloud = input.cloud ?? this.opts.identityStore?.get(this.opts.profileId ?? defaultProfileId()) ?? null;
    if (!cloud?.controlPlaneUrl) {
      return fallbackTarget(input, "unresolved");
    }
    const auth = await this.createDirectoryAuthContext(cloud);
    if (!auth) return fallbackTarget(input, "unresolved");

    let peerUserId = input.peerUserId ?? null;
    let agentInfo: CloudAgentInstanceDirectoryEntry | null = null;
    if (!peerUserId && input.peerAgentInstanceId) {
      agentInfo = await getPeerAgentInstance(auth, input.peerAgentInstanceId);
      peerUserId = agentInfo?.user_id ?? null;
    }

    if (peerUserId) {
      const directory = await getPeerUserDirectory(auth, peerUserId);
      if (directory) {
        const best = chooseRelayPeerAgent(directory.agents ?? [], input.capability);
        return {
          agentInstanceId: best?.agent_instance_id ?? agentInfo?.agent_instance_id ?? input.peerAgentInstanceId ?? null,
          userId: directory.user_id ?? peerUserId,
          displayName: directory.display_name ?? agentInfo?.display_name ?? input.title ?? null,
          email: directory.email ?? agentInfo?.email ?? null,
          presence: best?.status ?? directory.presence ?? directory.status ?? agentInfo?.status ?? "unknown",
          reason: "user_agents"
        };
      }
    }

    if (!agentInfo && input.peerAgentInstanceId) {
      agentInfo = await getPeerAgentInstance(auth, input.peerAgentInstanceId);
    }
    if (agentInfo) {
      return {
        agentInstanceId: agentInfo.agent_instance_id,
        userId: agentInfo.user_id,
        displayName: agentInfo.display_name || agentInfo.device_name || input.title || null,
        email: agentInfo.email,
        presence: agentInfo.status || "unknown",
        reason: "agent_instance"
      };
    }

    return fallbackTarget(input, "fallback");
  }

  private async createDirectoryAuthContext(cloud: LocalCloudIdentity): Promise<DirectoryAuthContext | null> {
    let userToken = cloud.userAccessToken;
    if (cloud.refreshToken && this.opts.enrollmentService) {
      userToken = await this.opts.enrollmentService.refreshUserAccessToken().catch(() => userToken ?? null);
    }
    if (!userToken && !cloud.deviceAccessToken) return null;
    return {
      client: new DirectoryClient(new ControlPlaneClient(cloud.controlPlaneUrl)),
      userToken: userToken ?? null,
      deviceToken: cloud.deviceAccessToken ?? null
    };
  }
}

export function chooseRelayPeerAgent(agents: CloudAgentInstance[], capability?: string): CloudAgentInstance | null {
  const normalizedCapability = normalizeCapability(capability);
  const ranked = [...agents].sort((a, b) => {
    const supportRank = capabilityScore(b, normalizedCapability) - capabilityScore(a, normalizedCapability);
    if (supportRank !== 0) return supportRank;
    const statusRank = statusScore(b.status) - statusScore(a.status);
    if (statusRank !== 0) return statusRank;
    return Date.parse(agentLastSeenAt(b) ?? "0") - Date.parse(agentLastSeenAt(a) ?? "0");
  });
  return ranked[0] ?? null;
}

export function statusScore(status: string): number {
  if (status === "online") return 3;
  if (status === "stale") return 2;
  if (status === "offline") return 1;
  return 0;
}

function capabilityScore(agent: CloudAgentInstance, capability?: string): number {
  if (!capability) return 1;
  const caps = Array.isArray(agent.capabilities) ? agent.capabilities : [];
  if (caps.length === 0) return 1;
  if (caps.includes(capability)) return 3;
  if (capability === "message.send" && caps.includes("a2a.v1")) return 2;
  if (capability === "file.request.search" && (caps.includes("a2a.v1") || caps.includes("file.request") || caps.includes("file.request.search"))) return 2;
  if (capability === "file.transfer" && (caps.includes("a2a.v1") || caps.includes("file.transfer"))) return 2;
  return 0;
}

function normalizeCapability(capability?: string): string | undefined {
  if (capability === "file.request") return "file.request.search";
  return capability;
}

function agentLastSeenAt(agent: CloudAgentInstance): string | null {
  return agent.last_seen_at ?? agent.last_heartbeat_at ?? null;
}

async function getPeerUserDirectory(auth: DirectoryAuthContext, userId: string): Promise<CloudUserAgents | null> {
  if (auth.userToken) {
    try {
      return await auth.client.getUserAgents(userId, auth.userToken);
    } catch {
      // Device auth fallback keeps routing alive after user-token expiry.
    }
  }
  if (auth.deviceToken) {
    try {
      return await auth.client.getUserAgentsWithDevice(userId, auth.deviceToken);
    } catch {
      return null;
    }
  }
  return null;
}

async function getPeerAgentInstance(auth: DirectoryAuthContext, agentInstanceId: string): Promise<CloudAgentInstanceDirectoryEntry | null> {
  if (auth.userToken) {
    try {
      return await auth.client.getAgentInstance(agentInstanceId, auth.userToken);
    } catch {
      // Device auth fallback keeps routing alive after user-token expiry.
    }
  }
  if (auth.deviceToken) {
    try {
      return await auth.client.getAgentInstanceWithDevice(agentInstanceId, auth.deviceToken);
    } catch {
      return null;
    }
  }
  return null;
}

function fallbackTarget(
  input: { peerUserId?: string | null; peerAgentInstanceId?: string | null; title?: string | null },
  reason: PeerTargetResolution["reason"]
): PeerTargetResolution {
  return {
    agentInstanceId: input.peerAgentInstanceId ?? null,
    userId: input.peerUserId ?? null,
    displayName: input.title ?? null,
    email: null,
    presence: "unknown",
    reason
  };
}
