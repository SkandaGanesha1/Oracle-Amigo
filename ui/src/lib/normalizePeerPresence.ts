import type { Conversation, PeerPresence, PresenceState } from "../types.js";

interface PresenceInput {
  presence?: PresenceState | string | null;
  agentInstanceId?: string | null;
  activeAgentInstanceId?: string | null;
  lastHeartbeatAt?: string | null;
  capabilities?: string[];
}

export function normalizePeerPresence(input: Conversation | PresenceInput | null | undefined): PeerPresence {
  if (!input) {
    return { status: "unavailable", reason: "unknown", label: "Presence unavailable" };
  }

  const activeAgentInstanceId = "activeAgentInstanceId" in input ? input.activeAgentInstanceId : undefined;
  const agentInstanceId = "agentInstanceId" in input ? input.agentInstanceId : undefined;
  if (activeAgentInstanceId && agentInstanceId && activeAgentInstanceId !== agentInstanceId) {
    return {
      status: "stale",
      reason: "stale_route",
      label: "Old agent route - switch to current agent",
      activeAgentInstanceId,
      capabilities: "capabilities" in input ? input.capabilities : undefined
    };
  }

  const rawPresence = String(input.presence ?? "unknown");
  if (rawPresence === "online") {
    return {
      status: "online",
      reason: "heartbeat_recent",
      label: "Online",
      activeAgentInstanceId: activeAgentInstanceId ?? agentInstanceId ?? undefined,
      capabilities: "capabilities" in input ? input.capabilities : undefined
    };
  }
  if (rawPresence === "stale") {
    return {
      status: "stale",
      reason: "heartbeat_stale",
      label: "Stale",
      activeAgentInstanceId: activeAgentInstanceId ?? agentInstanceId ?? undefined,
      capabilities: "capabilities" in input ? input.capabilities : undefined
    };
  }
  if (rawPresence === "offline" || rawPresence === "revoked") {
    return {
      status: "offline",
      reason: rawPresence === "revoked" ? "not_enrolled" : "no_active_agent",
      label: rawPresence === "revoked" ? "Offline" : "Offline",
      activeAgentInstanceId: activeAgentInstanceId ?? agentInstanceId ?? undefined,
      capabilities: "capabilities" in input ? input.capabilities : undefined
    };
  }
  return {
    status: "unavailable",
    reason: "unknown",
    label: "Presence unavailable",
    activeAgentInstanceId: activeAgentInstanceId ?? agentInstanceId ?? undefined,
    capabilities: "capabilities" in input ? input.capabilities : undefined
  };
}

export function presenceBadgeColor(presence: PeerPresence): "success" | "warning" | "default" | "danger" {
  if (presence.status === "online") return "success";
  if (presence.reason === "stale_route") return "warning";
  if (presence.status === "stale") return "warning";
  if (presence.status === "offline") return "default";
  return "default";
}
