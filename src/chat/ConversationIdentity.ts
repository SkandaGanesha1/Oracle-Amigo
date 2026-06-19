export type RelayConversationIdentityInput = {
  peerUserId?: string | null;
  peerAgentInstanceId?: string | null;
  peer_user_id?: string | null;
  peer_agent_instance_id?: string | null;
};

function peerUserId(input: RelayConversationIdentityInput): string | null {
  return input.peerUserId ?? input.peer_user_id ?? null;
}

function peerAgentInstanceId(input: RelayConversationIdentityInput): string | null {
  return input.peerAgentInstanceId ?? input.peer_agent_instance_id ?? null;
}

export function canonicalRelayConversationId(input: RelayConversationIdentityInput): string {
  const userId = peerUserId(input);
  if (userId) return `relay_user_${userId}`;
  const agentInstanceId = peerAgentInstanceId(input);
  if (agentInstanceId) return `relay_agent_${agentInstanceId}`;
  throw new Error("Cannot create relay conversation without peer user or agent instance");
}

export function isCanonicalRelayConversationId(
  conversationId: string,
  input: RelayConversationIdentityInput
): boolean {
  try {
    return conversationId === canonicalRelayConversationId(input);
  } catch {
    return false;
  }
}
