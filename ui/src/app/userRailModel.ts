import type { CloudStatus, Contact, Conversation, DirectoryUser, PeerPresence } from "../types";
import { normalizePeerPresence } from "../lib/normalizePeerPresence";

export interface RailUser {
  id: string;
  displayName: string;
  email: string | null;
  conversationId: string | null;
  avatarSeed: string;
  presence: PeerPresence;
  unread: number;
  isLocalAgent: boolean;
}

const RAW_AGENT_RE = /\bag[ei]_[a-f0-9-]{8,}/i;
const REMOTE_AGENT_RE = /remote agent/i;
const LOCAL_AGENT_RE = /(^local-agent$|my local agent|oracle amigo local agent)/i;

export function buildRailUsers(
  conversations: Conversation[],
  cloudStatus: CloudStatus | undefined,
  contacts: Contact[] = [],
  directoryUsers: DirectoryUser[] = []
): RailUser[] {
  const localConversation = conversations.find((conversation) =>
    conversation.id === "local-agent" ||
    (!conversation.peerUserId && !conversation.agentInstanceId && LOCAL_AGENT_RE.test(conversation.title))
  );
  const currentUserId = cloudStatus?.cloud?.userId ?? null;
  const directoryByUserId = new Map(directoryUsers.map((user) => [user.user_id, user]));
  const directoryByAgentInstanceId = new Map<string, DirectoryUser>();
  for (const user of directoryUsers) {
    for (const agent of user.agents ?? []) {
      directoryByAgentInstanceId.set(agent.agent_instance_id, user);
    }
  }

  const localUser: RailUser = {
    id: "local-agent",
    displayName: "My local agent",
    email: cloudStatus?.cloud?.userEmail ?? null,
    conversationId: localConversation?.id ?? null,
    avatarSeed: cloudStatus?.cloud?.agentInstanceId ?? cloudStatus?.cloud?.userEmail ?? "local-agent",
    presence: {
      status: cloudStatus?.cloud?.status === "enrolled" ? "online" : "offline",
      reason: cloudStatus?.cloud?.status === "enrolled" ? "heartbeat_recent" : "not_enrolled",
      label: cloudStatus?.cloud?.status === "enrolled" ? "Online" : "Offline",
      activeAgentInstanceId: cloudStatus?.cloud?.agentInstanceId ?? undefined
    },
    unread: localConversation?.unread ?? 0,
    isLocalAgent: true
  };

  const remoteUsers = new Map<string, RailUser>();
  for (const conversation of conversations) {
    const directoryUser = conversation.peerUserId
      ? directoryByUserId.get(conversation.peerUserId)
      : conversation.agentInstanceId
        ? directoryByAgentInstanceId.get(conversation.agentInstanceId)
        : undefined;
    const id = conversation.peerUserId ?? directoryUser?.user_id ?? (conversation.agentInstanceId ? `agent:${conversation.agentInstanceId}` : null);
    if (!id || id === currentUserId) continue;
    const existing = remoteUsers.get(id);
    const presence = directoryUser
      ? normalizePeerPresence({
          presence: directoryUser.presence,
          activeAgentInstanceId: directoryUser.agents?.find((agent) => agent.status === "online")?.agent_instance_id ?? directoryUser.agents?.[0]?.agent_instance_id ?? null,
          capabilities: directoryUser.agents?.flatMap((agent) => agent.capabilities ?? [])
        })
      : normalizePeerPresence(conversation);
    const candidate: RailUser = {
      id,
      displayName: safePersonName(directoryUser?.display_name ?? conversation.title, directoryUser?.email ?? conversation.subtitle),
      email: directoryUser?.email ?? (conversation.subtitle.includes("@") ? conversation.subtitle.split(" ")[0] : null),
      conversationId: conversation.id,
      avatarSeed: directoryUser?.email ?? conversation.agentInstanceId ?? `${id}:${conversation.title}`,
      presence,
      unread: railMessageBadgeCount(conversation),
      isLocalAgent: false
    };
    remoteUsers.set(id, existing ? mergeRailUser(existing, candidate) : candidate);
  }

  for (const conversation of conversations) {
    if (conversation.peerUserId || conversation.agentInstanceId) continue;
    const displayName = safePersonName(conversation.title, conversation.subtitle);
    if (displayName === "Contact" || LOCAL_AGENT_RE.test(displayName)) continue;
    const id = `conversation:${conversation.id}`;
    if (remoteUsers.has(id)) continue;
    remoteUsers.set(id, {
      id,
      displayName,
      email: null,
      conversationId: conversation.id,
      avatarSeed: `${conversation.id}:${displayName}`,
      presence: normalizePeerPresence(conversation),
      unread: railMessageBadgeCount(conversation),
      isLocalAgent: false
    });
  }

  for (const contact of contacts) {
    if (contact.status === "blocked" || contact.status === "declined") continue;
    const peerUserId = peerUserIdForContact(contact, currentUserId);
    if (!peerUserId || peerUserId === currentUserId || remoteUsers.has(peerUserId)) continue;
    const directoryUser = directoryByUserId.get(peerUserId);
    const isTarget = contact.target_user_id === peerUserId;
    const displayName = safePersonName(
      directoryUser?.display_name ?? (isTarget ? contact.target_display_name : contact.requester_display_name) ?? "Contact",
      directoryUser?.email ?? (isTarget ? contact.target_email : contact.requester_email) ?? null
    );
    remoteUsers.set(peerUserId, {
      id: peerUserId,
      displayName,
      email: directoryUser?.email ?? (isTarget ? contact.target_email : contact.requester_email) ?? null,
      conversationId: null,
      avatarSeed: directoryUser?.email ?? peerUserId,
      presence: normalizePeerPresence({
        presence: directoryUser?.presence ?? "unknown",
        activeAgentInstanceId: directoryUser?.agents?.find((agent) => agent.status === "online")?.agent_instance_id ?? directoryUser?.agents?.[0]?.agent_instance_id ?? null,
        capabilities: directoryUser?.agents?.flatMap((agent) => agent.capabilities ?? [])
      }),
      unread: 0,
      isLocalAgent: false
    });
  }

  return [localUser, ...Array.from(remoteUsers.values()).sort(sortRailUsers)];
}

export function safePersonName(title: string, fallback?: string | null): string {
  const cleanTitle = title.trim();
  if (cleanTitle && !RAW_AGENT_RE.test(cleanTitle) && !REMOTE_AGENT_RE.test(cleanTitle)) return cleanTitle;
  const cleanFallback = (fallback ?? "").trim();
  if (cleanFallback && !RAW_AGENT_RE.test(cleanFallback) && !REMOTE_AGENT_RE.test(cleanFallback)) return cleanFallback;
  return "Contact";
}

function mergeRailUser(existing: RailUser, candidate: RailUser): RailUser {
  const candidatePresenceRank = presenceRank(candidate.presence);
  const existingPresenceRank = presenceRank(existing.presence);
  const preferred = candidatePresenceRank > existingPresenceRank ? candidate : existing;
  const fallback = preferred === candidate ? existing : candidate;
  return {
    ...preferred,
    displayName: preferred.displayName === "Contact" ? fallback.displayName : preferred.displayName,
    conversationId: preferred.conversationId ?? fallback.conversationId,
    unread: existing.unread + candidate.unread
  };
}

function railMessageBadgeCount(conversation: Conversation): number {
  const explicitUnread = conversation.unread ?? 0;
  if (explicitUnread > 0) return explicitUnread;
  return conversation.messages.filter((message) => message.kind === "human" && message.direction === "incoming").length;
}

function sortRailUsers(a: RailUser, b: RailUser): number {
  if (b.unread !== a.unread) return b.unread - a.unread;
  return presenceRank(b.presence) - presenceRank(a.presence) || a.displayName.localeCompare(b.displayName);
}

function peerUserIdForContact(contact: Contact, currentUserId: string | null): string | null {
  if (currentUserId) {
    if (contact.requester_user_id === currentUserId) return contact.target_user_id;
    if (contact.target_user_id === currentUserId) return contact.requester_user_id;
  }
  return contact.target_user_id || contact.requester_user_id || null;
}

function presenceRank(presence: PeerPresence): number {
  if (presence.status === "online") return 3;
  if (presence.status === "stale") return 2;
  if (presence.status === "offline") return 1;
  return 0;
}
