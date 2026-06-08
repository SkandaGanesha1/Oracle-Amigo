import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, mapApproval } from "../api/client";
import type { ChatSendRequest, Conversation, CreateConversationRequest, FileCandidateApprovalCard, TimelineMessage } from "../api/types";
import { PollingTransport } from "../realtime/RealtimeTransport";

export const queryKeys = {
  cloudStatus: ["cloud-status"] as const,
  currentProfile: ["current-profile"] as const,
  directory: (query: string) => ["directory", query] as const,
  contacts: ["contacts"] as const,
  conversations: ["chat", "conversations"] as const,
  conversationMessages: (conversationId: string) => ["chat", "conversations", conversationId, "messages"] as const,
  pendingApprovals: ["approvals", "pending"] as const,
  receivedFiles: ["files", "received"] as const,
  auditEvents: ["audit", "events"] as const,
  diagnostics: ["agent", "diagnostics"] as const,
  relayInbox: ["relay", "inbox-status"] as const
};

export function useCloudStatus() {
  return useQuery({ queryKey: queryKeys.cloudStatus, queryFn: api.cloudStatus, refetchInterval: 5000 });
}

export function useCurrentProfile() {
  return useQuery({ queryKey: queryKeys.currentProfile, queryFn: api.me });
}

export function useDirectorySearch(query: string) {
  return useQuery({
    queryKey: queryKeys.directory(query),
    queryFn: () => api.directoryUsers(query),
    enabled: query.trim().length > 0,
    staleTime: 5000
  });
}

export function useContacts(enabled = true) {
  return useQuery({ queryKey: queryKeys.contacts, queryFn: api.contacts, enabled, refetchInterval: enabled ? 10000 : false });
}

export function useConversations() {
  return useQuery({ queryKey: queryKeys.conversations, queryFn: api.conversations, refetchInterval: 3000 });
}

export function useConversationMessages(conversationId: string | null) {
  return useQuery({
    queryKey: queryKeys.conversationMessages(conversationId ?? "none"),
    queryFn: () => api.conversationMessages(conversationId ?? "local-agent"),
    enabled: Boolean(conversationId),
    refetchInterval: 3000
  });
}

export function useStartConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateConversationRequest) => api.createConversation(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.conversations });
      const previous = queryClient.getQueryData<{ conversations: Conversation[] }>(queryKeys.conversations);
      const optimistic: Conversation = {
        id: `optimistic-${crypto.randomUUID()}`,
        title: input.title,
        subtitle: "Starting conversation",
        agentInstanceId: input.peer_agent_instance_id ?? null,
        presence: "unknown",
        unread: 0,
        lastMessage: "Conversation starting",
        pendingApprovals: 0,
        transferCount: 0,
        messages: []
      };
      queryClient.setQueryData<{ conversations: Conversation[] }>(queryKeys.conversations, {
        conversations: [optimistic, ...(previous?.conversations ?? [])]
      });
      return { previous };
    },
    onError: (_err, _input, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.conversations, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    }
  });
}

export function useSendMessage(conversationId: string) {
  return useSendChatMutation(conversationId, "normal");
}

export function useSendFileRequest(conversationId: string) {
  return useSendChatMutation(conversationId, "file_request");
}

function useSendChatMutation(conversationId: string, sendAs: ChatSendRequest["send_as"]) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { text: string; clientMessageId?: string }) => api.sendChatMessage(conversationId, {
      text: input.text,
      send_as: sendAs,
      client_message_id: input.clientMessageId,
      idempotency_key: input.clientMessageId ? `ui-${input.clientMessageId}` : undefined
    }),
    onMutate: async (input) => {
      const messageId = input.clientMessageId ?? crypto.randomUUID();
      const queryKey = queryKeys.conversationMessages(conversationId);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<{ conversationId: string; messages: TimelineMessage[] }>(queryKey);
      const optimistic: TimelineMessage = {
        kind: "human",
        id: messageId,
        conversation_id: conversationId,
        sender_user_id: null,
        sender_agent_instance_id: null,
        receiver_agent_instance_id: null,
        text: input.text,
        created_at: new Date().toISOString(),
        delivery_status: "local_pending"
      };
      queryClient.setQueryData<{ conversationId: string; messages: TimelineMessage[] }>(queryKey, {
        conversationId,
        messages: [...(previous?.messages ?? []), optimistic]
      });
      return { previous, queryKey };
    },
    onError: (_err, _input, context) => {
      if (context?.previous) queryClient.setQueryData(context.queryKey, context.previous);
    },
    onSettled: (_result, _error, _input, context) => {
      if (context?.queryKey) void queryClient.invalidateQueries({ queryKey: context.queryKey });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    }
  });
}

export function usePendingApprovals() {
  const query = useQuery({ queryKey: queryKeys.pendingApprovals, queryFn: api.pendingApprovals, refetchInterval: 3000 });
  const approvalCards = useMemo<FileCandidateApprovalCard[]>(
    () => (query.data?.approvals ?? []).map(mapApproval),
    [query.data]
  );
  return { ...query, approvalCards };
}

export function useApproveFileRequest() {
  return useApprovalMutation(api.approve);
}

export function useRejectFileRequest() {
  return useApprovalMutation(api.reject);
}

export function useSubmitApprovalFeedback() {
  return useApprovalMutation((id, feedback) => api.feedback(id, feedback ?? ""));
}

function useApprovalMutation(fn: (id: string, feedback?: string) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { approvalId: string; feedback?: string }) => fn(input.approvalId, input.feedback),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.pendingApprovals });
      const previous = queryClient.getQueryData<{ approvals: Array<Record<string, unknown>> }>(queryKeys.pendingApprovals);
      queryClient.setQueryData<{ approvals: Array<Record<string, unknown>> }>(queryKeys.pendingApprovals, {
        approvals: (previous?.approvals ?? []).map((approval) => {
          const id = String(approval.id ?? approval.approvalId ?? "");
          return id === input.approvalId ? { ...approval, status: "decision_pending" } : approval;
        })
      });
      return { previous };
    },
    onError: (_err, _input, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.pendingApprovals, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pendingApprovals });
      void queryClient.invalidateQueries({ queryKey: queryKeys.auditEvents });
      void queryClient.invalidateQueries({ queryKey: queryKeys.receivedFiles });
    }
  });
}

export function useReceivedFiles() {
  return useQuery({ queryKey: queryKeys.receivedFiles, queryFn: api.files, refetchInterval: 5000 });
}

export function useAuditEvents() {
  return useQuery({ queryKey: queryKeys.auditEvents, queryFn: api.audit, refetchInterval: 7000 });
}

export function useAgentDiagnostics() {
  return useQuery({
    queryKey: queryKeys.diagnostics,
    queryFn: async () => ({
      health: await api.health(),
      cloud: await api.cloudStatus(),
      relayInbox: await api.relayInboxStatus()
    }),
    refetchInterval: 5000
  });
}

export function useRealtimePolling() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const transport = new PollingTransport([
      { queryKey: [...queryKeys.conversations], intervalMs: 3000 },
      { queryKey: [...queryKeys.relayInbox], intervalMs: 3000 },
      { queryKey: [...queryKeys.pendingApprovals], intervalMs: 3000 },
      { queryKey: [...queryKeys.cloudStatus], intervalMs: 10000 }
    ]);
    transport.start(queryClient);
    return () => transport.stop();
  }, [queryClient]);
}
