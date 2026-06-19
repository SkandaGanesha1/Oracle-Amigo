import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queries";

export function shouldRefetchActiveConversationRealtime(
  conversationId: string | null,
  event: { kind?: string; payload?: Record<string, unknown> } | undefined
): boolean {
  if (!conversationId) return false;
  if (event?.kind !== "conversation_update" && event?.kind !== "message_created") return false;
  const eventConversationId = event.payload?.conversationId;
  return eventConversationId === conversationId;
}

export function useActiveConversationLiveSync(
  conversationId: string | null,
  _messagesQuery?: unknown
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!conversationId) return;
    const activeConversationId = conversationId;
    function handleRealtimeEvent(event: Event) {
      const detail = (event as CustomEvent<{ kind?: string; payload?: Record<string, unknown> }>).detail;
      if (!shouldRefetchActiveConversationRealtime(activeConversationId, detail)) return;
      // Source contract: queryKeys.conversationMessages(conversationId)
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationMessages(activeConversationId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    }
    window.addEventListener("oa-realtime-event", handleRealtimeEvent);
    return () => window.removeEventListener("oa-realtime-event", handleRealtimeEvent);
  }, [conversationId, queryClient]);
}
