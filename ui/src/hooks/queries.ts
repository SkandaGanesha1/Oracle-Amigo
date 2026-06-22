import { useEffect, useMemo, useCallback, useSyncExternalStore } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, mapApproval } from "../api/client";
import { fileIndexApi } from "../api/client";
import { ApiRequestError } from "../api/localAgentClient";
import {
  isCloudUserSessionReady,
  markCloudUserBlocked,
  reconcileCloudUserSessionFromStatus,
  useCloudUserSession
} from "../api/cloudUserSessionStore";
import { isLocalUiSessionReady, useLocalUiSession } from "../api/localUiSessionStore";
import type { AgentProfileDetail, ChatSendRequest, ChatSendResult, Conversation, ConversationMessagesResult, CreateConversationRequest, FileCandidateApprovalCard, RegistryTrustLevel, TimelineMessage, ConsentRecord, WorkflowEvent, CloudStatus, MissionThreadMessage, PolicyRule, TaskMissionProjection, TrustRelationship, UserAgentSettings } from "../api/types";
import type { InboxItemsParams, InboxServerAction } from "../api/inboxApi";
import type { UniversalSearchResult } from "../types/agentic";
import { SseTransport } from "../realtime/RealtimeTransport";
import { toast } from "../components/primitives/OracleToast";

const QUEUE_KEY = "oa-queued-messages";
const queueListeners = new Set<() => void>();

interface QueuedMessage {
  conversationId: string;
  clientMessageId: string;
  failedAt: string;
  failureReason: string;
  textPreview?: string;
}

const queuedMessageText = new Map<string, string>();

function getQueue(): QueuedMessage[] {
  try {
    return sanitizeQueueRecords(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]"));
  } catch { return []; }
}

function migrateQueueStorage(): void {
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return;
    const migrated = sanitizeQueueRecords(JSON.parse(raw));
    const next = JSON.stringify(migrated);
    if (raw !== next) localStorage.setItem(QUEUE_KEY, next);
  } catch {
    localStorage.removeItem(QUEUE_KEY);
  }
}

function sanitizeQueueRecords(value: unknown): QueuedMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = item as Record<string, unknown>;
      return {
        conversationId: String(record.conversationId ?? ""),
        clientMessageId: String(record.clientMessageId ?? ""),
        failedAt: String(record.failedAt ?? new Date().toISOString()),
        failureReason: String(record.failureReason ?? "unknown"),
        textPreview: typeof record.textPreview === "string" ? record.textPreview : "[message content not persisted]"
      };
    })
    .filter((item) => item.conversationId && item.clientMessageId);
}

migrateQueueStorage();

function setQueue(queue: QueuedMessage[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  emitQueueChange();
}

function emitQueueChange(): void {
  for (const listener of queueListeners) listener();
}

function subscribeQueue(listener: () => void): () => void {
  queueListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    queueListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function getQueueSnapshot(): string {
  return localStorage.getItem(QUEUE_KEY) ?? "[]";
}

function getQueueServerSnapshot(): string {
  return "[]";
}

function useQueueSnapshot(): QueuedMessage[] {
  const snapshot = useSyncExternalStore(subscribeQueue, getQueueSnapshot, getQueueServerSnapshot);
  return useMemo(() => {
    try {
      return sanitizeQueueRecords(JSON.parse(snapshot));
    } catch {
      return [];
    }
  }, [snapshot]);
}

function presenceRank(presence: Conversation["presence"]): number {
  if (presence === "online") return 4;
  if (presence === "stale") return 3;
  if (presence === "unknown") return 2;
  if (presence === "offline") return 1;
  return 0;
}

function addToQueue(msg: QueuedMessage): void {
  const queue = getQueue().filter((q) => q.clientMessageId !== msg.clientMessageId);
  queue.push(msg);
  setQueue(queue);
}

function rememberQueuedMessageText(clientMessageId: string, text: string): void {
  queuedMessageText.set(clientMessageId, text);
}

function removeFromQueue(conversationId: string, clientMessageId: string): void {
  queuedMessageText.delete(clientMessageId);
  setQueue(getQueue().filter((q) => !(q.conversationId === conversationId && q.clientMessageId === clientMessageId)));
}

function clearConversationQueue(conversationId: string): void {
  const queue = getQueue();
  for (const msg of queue) {
    if (msg.conversationId === conversationId) queuedMessageText.delete(msg.clientMessageId);
  }
  setQueue(queue.filter((q) => q.conversationId !== conversationId));
}

export const queryKeys = {
  cloudStatus: ["cloud-status"] as const,
  currentProfile: ["current-profile"] as const,
  directory: (query: string) => ["directory", query] as const,
  contacts: ["contacts"] as const,
  agentProfiles: ["agent", "profiles"] as const,
  agentProfile: (id: string) => ["agent", "profiles", id] as const,
  conversations: ["chat", "conversations"] as const,
  conversationMessages: (conversationId: string) => ["chat", "conversations", conversationId, "messages"] as const,
  chatThread: (conversationId: string, threadId: string) => ["chat", "conversations", conversationId, "threads", threadId] as const,
  pendingApprovals: ["approvals", "pending"] as const,
  receivedFiles: ["files", "received"] as const,
  auditEvents: ["audit", "events"] as const,
  auditVerify: ["audit", "verify"] as const,
  diagnostics: ["agent", "diagnostics"] as const,
  relayInbox: ["relay", "inbox-status"] as const,
  relayTask: (relayTaskId: string) => ["relay", "task", relayTaskId] as const,
  registryAgents: (trustLevel = "all") => ["registry", "agents", trustLevel] as const,
  skills: ["skills"] as const,
  fileIndexRoots: ["files", "index-roots"] as const,
  indexedFiles: (limit = 100, offset = 0, query = "", extension = "") => ["files", "indexed", limit, offset, query, extension] as const,
  fileSearch: (query: string) => ["files", "search", query] as const,
  transfers: ["transfers"] as const,
  a2aTasks: ["a2a", "tasks"] as const,
  a2aTask: (taskId: string) => ["a2a", "tasks", taskId] as const,
  a2aTaskEvents: (taskId: string) => ["a2a", "tasks", taskId, "events"] as const,
  agentRuns: ["agent", "runs"] as const,
  agentRun: (runId: string) => ["agent", "runs", runId] as const,
  memoryConversations: ["memory", "conversations"] as const,
  memoryWindow: (conversationId: string) => ["memory", "conversations", conversationId, "window"] as const,
  episodicMemory: (query = "recent") => ["memory", "episodic", query] as const,
  longTermMemory: (namespace = "default", query = "") => ["memory", "long-term", namespace, query] as const,
  policySummary: ["policy", "summary"] as const,
  policyRules: ["policy", "rules"] as const,
  policyEvaluation: ["policy", "evaluation"] as const,
  universalSearch: (query: string) => ["search", "universal", query] as const,
  missionThread: (missionId: string) => ["missions", missionId, "thread"] as const,
  notifications: ["notifications"] as const,
  biometricCapability: ["biometric", "capability"] as const,
  missions: ["missions"] as const,
  voiceCommands: ["voice", "commands"] as const,
  voiceCommand: (id: string) => ["voice", "commands", id] as const,
  userAgentSettings: ["settings", "user-agent"] as const,
  consent: (id: string) => ["consent", id] as const,
  trustGraph: ["trust", "graph"] as const,
  inboxItems: (params: InboxItemsParams) => ["inbox", "items", params] as const,
  inboxItem: (itemId: string) => ["inbox", "items", itemId] as const
};

function normalizeWorkflowEvent(data: unknown): WorkflowEvent | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as WorkflowEvent;
  const payload = raw.payload_json ?? raw.payloadJson;
  return {
    ...raw,
    eventType: raw.eventType ?? raw.event_type,
    taskId: raw.taskId ?? raw.task_id,
    createdAt: raw.createdAt ?? raw.created_at,
    payloadJson: typeof payload === "string" ? safeJson(payload) : payload
  };
}

function safeJson(input: string): Record<string, unknown> | string {
  try {
    return JSON.parse(input) as Record<string, unknown>;
  } catch {
    return input;
  }
}

function shallowEqualRecord(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bRecord, key) || !Object.is(aRecord[key], bRecord[key])) {
      return false;
    }
  }
  return true;
}

function isConversationMessagesResult(value: unknown): value is ConversationMessagesResult {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as ConversationMessagesResult).conversationId === "string" &&
    Array.isArray((value as ConversationMessagesResult).messages)
  );
}

function structurallyShareMessages(oldValue: unknown, newValue: unknown): unknown {
  if (!isConversationMessagesResult(newValue)) return newValue;
  const oldData = isConversationMessagesResult(oldValue) ? oldValue : undefined;
  const newData = newValue;
  if (!oldData || oldData.conversationId !== newData.conversationId) return newData;

  const previousById = new Map(oldData.messages.map((message) => [message.id, message]));
  let changed =
    oldData.messages.length !== newData.messages.length ||
    !shallowEqualRecord(oldData.conversation, newData.conversation) ||
    !shallowEqualRecord(oldData.readState, newData.readState) ||
    !shallowEqualRecord(oldData.pageInfo, newData.pageInfo);
  const messages = newData.messages.map((message, index) => {
    const previous = previousById.get(message.id);
    if (previous && shallowEqualRecord(previous, message)) {
      if (oldData.messages[index] !== previous) changed = true;
      return previous;
    }
    changed = true;
    return message;
  });

  if (!changed) return oldData;
  return { ...newData, messages };
}

export function useCloudStatus() {
  const query = useQuery({ queryKey: queryKeys.cloudStatus, queryFn: api.cloudStatus, refetchInterval: 5000 });
  useEffect(() => {
    reconcileCloudUserSessionFromStatus(query.data);
  }, [query.data]);
  return query;
}

export function useCurrentProfile() {
  const queryClient = useQueryClient();
  const localSession = useLocalUiSession();
  const cloudSession = useCloudUserSession();
  const { data: cloudStatus } = useCloudStatus();
  const cloudEnabled =
    isLocalUiSessionReady(localSession.status) &&
    isCloudUserSessionReady(cloudSession.status) &&
    isCloudUserReady(cloudStatus);
  return useQuery({
    queryKey: queryKeys.currentProfile,
    queryFn: async () => {
      try {
        return await api.me();
      } catch (error) {
        if (handleCloudAuthError(queryClient, error)) {
          return null;
        }
        throw error;
      }
    },
    enabled: cloudEnabled,
    retry: (failureCount, error) => !isCloudAuthError(error) && !(error instanceof ApiRequestError && error.status === 401) && failureCount < 1
  });
}

function isCloudAuthError(error: unknown): error is ApiRequestError {
  if (!(error instanceof ApiRequestError) || error.status !== 401) return false;
  const details = error.details;
  if (!details || typeof details !== "object") return false;
  const code = "error" in details ? String((details as { error?: unknown }).error ?? "") : "";
  return code === "CLOUD_USER_TOKEN_EXPIRED" || code === "CLOUD_USER_TOKEN_REQUIRED" || code === "CLOUD_NOT_CONFIGURED";
}

function cloudAuthIssueFromError(error: ApiRequestError): "required" | "expired" {
  const details = error.details;
  const code = details && typeof details === "object" && "error" in details
    ? String((details as { error?: unknown }).error ?? "")
    : "";
  return code === "CLOUD_USER_TOKEN_EXPIRED" ? "expired" : "required";
}

function handleCloudAuthError(queryClient: ReturnType<typeof useQueryClient>, error: unknown): boolean {
  if (!isCloudAuthError(error)) return false;
  markCloudUserBlocked(cloudAuthIssueFromError(error), error.message);
  void queryClient.cancelQueries({ queryKey: queryKeys.contacts });
  void queryClient.cancelQueries({ queryKey: ["directory"] });
  void queryClient.cancelQueries({ queryKey: queryKeys.currentProfile });
  queryClient.setQueryData(queryKeys.contacts, { contacts: [] });
  queryClient.removeQueries({ queryKey: ["directory"] });
  queryClient.removeQueries({ queryKey: queryKeys.currentProfile });
  void queryClient.invalidateQueries({ queryKey: queryKeys.cloudStatus });
  return true;
}

export function useDirectorySearch(query: string, enabled = query.trim().length > 0) {
  const queryClient = useQueryClient();
  const localSession = useLocalUiSession();
  const cloudSession = useCloudUserSession();
  const { data: cloudStatus } = useCloudStatus();
  const normalizedQuery = query.trim();
  const cloudEnabled =
    enabled &&
    normalizedQuery.length > 0 &&
    isLocalUiSessionReady(localSession.status) &&
    isCloudUserSessionReady(cloudSession.status) &&
    isCloudUserReady(cloudStatus);

  return useQuery({
    queryKey: queryKeys.directory(query),
    queryFn: async () => {
      try {
        return await api.directoryUsers(normalizedQuery);
      } catch (error) {
        if (handleCloudAuthError(queryClient, error)) {
          return { users: [] };
        }
        throw error;
      }
    },
    enabled: cloudEnabled,
    staleTime: 15000,
    retry: (failureCount, error) => !isCloudAuthError(error) && failureCount < 1
  });
}

export function isCloudUserReady(status: CloudStatus | undefined): boolean {
  const cloudStatus = status?.cloud.status;
  const cloudReady = cloudStatus === "authenticated" || cloudStatus === "enrolled";
  const hasUserToken = status?.cloud.hasUserAccessToken === true || status?.canRecoverUserToken === true;
  return Boolean(cloudReady && hasUserToken && status?.userAuthIssue == null && status?.tokenIssue !== "expired");
}

export function useContacts(enabled = true) {
  const queryClient = useQueryClient();
  const localSession = useLocalUiSession();
  const cloudSession = useCloudUserSession();
  const { data: cloudStatus } = useCloudStatus();
  const cloudEnabled =
    enabled &&
    isLocalUiSessionReady(localSession.status) &&
    isCloudUserSessionReady(cloudSession.status) &&
    isCloudUserReady(cloudStatus);
  return useQuery({
    queryKey: queryKeys.contacts,
    queryFn: async () => {
      try {
        return await api.contacts();
      } catch (error) {
        if (handleCloudAuthError(queryClient, error)) {
          return { contacts: [] };
        }
        throw error;
      }
    },
    enabled: cloudEnabled,
    refetchInterval: cloudEnabled ? 30000 : false,
    staleTime: 15000,
    retry: (failureCount, error) => !isCloudAuthError(error) && failureCount < 1
  });
}

export function useAgentProfiles() {
  return useQuery({
    queryKey: queryKeys.agentProfiles,
    queryFn: api.agentProfiles,
    refetchInterval: 10000,
    select: (data) => data.profiles
  });
}

export function useAgentProfile(id: string | null) {
  return useQuery({
    queryKey: queryKeys.agentProfile(id ?? "none"),
    queryFn: async () => {
      const result = await api.agentProfiles();
      return result.profiles.find((profile) =>
        profile.id === id ||
        profile.userId === id ||
        profile.agentInstanceId === id ||
        profile.registryDid === id
      ) ?? null;
    },
    enabled: Boolean(id),
    refetchInterval: 10000
  });
}

export function useConversations() {
  const localSession = useLocalUiSession();
  const localSessionReady = isLocalUiSessionReady(localSession.status);
  return useQuery({
    queryKey: queryKeys.conversations,
    queryFn: api.conversations,
    enabled: localSessionReady,
    refetchInterval: localSessionReady ? 3000 : false,
    select: (data) => {
      const seen = new Map<string, Conversation>();
      for (const conv of data.conversations ?? []) {
        const norm = conv.peerUserId ?? conv.agentInstanceId ?? conv.title.trim().toLowerCase().replace(/\s+/g, " ");
        const existing = seen.get(norm);
        if (!existing) {
          seen.set(norm, { ...conv, title: conv.title.trim().replace(/\s+/g, " ") });
        } else {
          const aMsgs = existing.messages ?? [];
          const bMsgs = conv.messages ?? [];
          const merged = [...aMsgs, ...bMsgs].filter(
            (msg, idx, arr) => arr.findIndex((m) => m.id === msg.id) === idx
          ).sort((a, b) => {
            const aTime = new Date(String((a as unknown as { received_at?: string; created_at?: string }).received_at ?? (a as unknown as { created_at?: string }).created_at ?? "")).getTime();
            const bTime = new Date(String((b as unknown as { received_at?: string; created_at?: string }).received_at ?? (b as unknown as { created_at?: string }).created_at ?? "")).getTime();
            return aTime - bTime;
          });
          const laterLastMsg = [existing, conv]
            .filter((c) => c.lastMessage && !["No messages yet", "Conversation starting", "Starting conversation"].includes(c.lastMessage))
            .sort((a, b) => (b.messages?.length ?? 0) - (a.messages?.length ?? 0));
          seen.set(norm, {
            ...existing,
            peerUserId: existing.peerUserId ?? conv.peerUserId ?? null,
            agentInstanceId: presenceRank(conv.presence) > presenceRank(existing.presence) ? conv.agentInstanceId : existing.agentInstanceId,
            presence: presenceRank(conv.presence) > presenceRank(existing.presence) ? conv.presence : existing.presence,
            messages: merged,
            lastMessage: laterLastMsg[0]?.lastMessage ?? existing.lastMessage,
            unread: Math.max(existing.unread, conv.unread),
            pendingApprovals: Math.max(existing.pendingApprovals, conv.pendingApprovals),
            transferCount: Math.max(existing.transferCount, conv.transferCount),
            subtitle: [existing.subtitle, conv.subtitle].filter(Boolean).sort((a, b) => b.length - a.length)[0] ?? existing.subtitle,
          });
        }
      }
      return { ...data, conversations: Array.from(seen.values()) };
    }
  });
}

export function useConversationMessages(conversationId: string | null) {
  const localSession = useLocalUiSession();
  const localSessionReady = isLocalUiSessionReady(localSession.status);
  return useQuery<ConversationMessagesResult>({
    queryKey: queryKeys.conversationMessages(conversationId ?? "none"),
    queryFn: () => api.conversationMessages(conversationId ?? ""),
    enabled: Boolean(conversationId) && localSessionReady,
    refetchInterval: () => {
      if (!localSessionReady) return false;
      return typeof document === "undefined" || document.visibilityState === "visible" ? 2000 : 15000;
    },
    refetchIntervalInBackground: true,
    refetchOnMount: "always",
    refetchOnReconnect: true,
    networkMode: "always",
    structuralSharing: structurallyShareMessages
  });
}

export function useUpdateConversationReadState(conversationId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (lastReadMessageId: string) => api.updateConversationReadState(conversationId ?? "", lastReadMessageId),
    onSuccess: ({ readState }) => {
      if (!conversationId) return;
      queryClient.setQueryData<ConversationMessagesResult>(
        queryKeys.conversationMessages(conversationId),
        (current) => current ? { ...current, readState } : current
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationMessages(conversationId) });
    }
  });
}

export function useLoadAroundMessage(conversationId: string | null) {
  const queryClient = useQueryClient();
  return useCallback(async (messageId: string) => {
    if (!conversationId) return;
    const data = await api.conversationMessages(conversationId, { around: messageId, limit: 80 });
    queryClient.setQueryData(queryKeys.conversationMessages(conversationId), data);
  }, [conversationId, queryClient]);
}

export function useLoadBeforeMessages(conversationId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (beforeMessageId: string) => {
      if (!conversationId) return null;
      return api.conversationMessages(conversationId, { before: beforeMessageId, limit: 80 });
    },
    onSuccess: (data) => {
      if (!conversationId || !data) return;
      queryClient.setQueryData<ConversationMessagesResult>(
        queryKeys.conversationMessages(conversationId),
        (current) => {
          if (!current) return data;
          const existingIds = new Set(current.messages.map((message) => message.id));
          const prepended = data.messages.filter((message) => !existingIds.has(message.id));
          return {
            ...current,
            messages: [...prepended, ...current.messages],
            pageInfo: {
              hasMoreBefore: data.pageInfo?.hasMoreBefore ?? false,
              hasMoreAfter: current.pageInfo?.hasMoreAfter ?? data.pageInfo?.hasMoreAfter ?? false,
              oldestMessageId: data.pageInfo?.oldestMessageId ?? prepended[0]?.id ?? current.pageInfo?.oldestMessageId,
              newestMessageId: current.pageInfo?.newestMessageId ?? current.messages.at(-1)?.id ?? data.pageInfo?.newestMessageId,
            },
            readState: data.readState ?? current.readState,
          };
        }
      );
    }
  });
}

export function usePinMessage(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, pinned }: { messageId: string; pinned: boolean }) =>
      api.pinChatMessage(conversationId, messageId, pinned),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationMessages(conversationId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    }
  });
}

export function useToggleMessageReaction(conversationId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, emoji, active }: { messageId: string; emoji: string; active: boolean }) =>
      api.setChatMessageReaction(conversationId ?? "", messageId, emoji, active),
    onSuccess: ({ message }, input) => {
      if (!conversationId) return;
      if (message) {
        queryClient.setQueryData<ConversationMessagesResult>(
          queryKeys.conversationMessages(conversationId),
          (current) => current ? {
            ...current,
            messages: current.messages.map((item) => item.id === input.messageId ? message : item)
          } : current
        );
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationMessages(conversationId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    }
  });
}

export function useThread(conversationId: string | null, threadId: string | null) {
  return useQuery({
    queryKey: queryKeys.chatThread(conversationId ?? "none", threadId ?? "none"),
    queryFn: () => api.chatThread(conversationId ?? "", threadId ?? ""),
    enabled: Boolean(conversationId && threadId)
  });
}

export function useCreateThreadReply(conversationId: string | null, threadId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => api.createChatThreadReply(conversationId ?? "", threadId ?? "", text),
    onSuccess: () => {
      if (!conversationId || !threadId) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatThread(conversationId, threadId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationMessages(conversationId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    }
  });
}

export function useRelayTaskStatus(relayTaskId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.relayTask(relayTaskId ?? "none"),
    queryFn: () => api.relayTaskStatus(relayTaskId ?? ""),
    enabled: Boolean(relayTaskId) && enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.delivery_status;
      return status === "queued_at_relay" || status === "delivered_to_remote_agent" ? 3000 : false;
    }
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
        peerUserId: input.peer_user_id ?? null,
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
    onSuccess: ({ conversation }) => {
      queryClient.setQueryData<{ conversations: Conversation[] }>(queryKeys.conversations, (current) => {
        const conversations = current?.conversations ?? [];
        return {
          conversations: [conversation, ...conversations.filter((item) => item.id !== conversation.id)]
        };
      });
      queryClient.setQueryData<ConversationMessagesResult>(queryKeys.conversationMessages(conversation.id), {
        conversationId: conversation.id,
        conversation,
        messages: conversation.messages ?? [],
        readState: conversation.readState ?? {
          conversationId: conversation.id,
          unreadCount: conversation.unread ?? 0,
          mentionCount: 0
        }
      });
    },
    onSettled: (data) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts });
      void queryClient.invalidateQueries({ queryKey: ["directory"] });
      if (data?.conversation?.id) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversationMessages(data.conversation.id) });
      }
    }
  });
}

export function useSendMessage(conversationId: string) {
  return useSendChatMutation(conversationId, "normal");
}

export function useSendFileRequest(conversationId: string) {
  return useSendChatMutation(conversationId, "file_request");
}

function isTransientSendError(err: unknown): boolean {
  if (err && typeof err === "object" && "details" in err) {
    const d = (err as { details: Record<string, unknown> }).details;
    if (d?.relay_unavailable === true) return true;
  }
  if (err && typeof err === "object" && "status" in err) {
    const s = (err as { status: number }).status;
    if (s === 503 || s === 429) return true;
  }
  return false;
}

function useSendChatMutation(conversationId: string, sendAs: ChatSendRequest["send_as"]) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { text: string; clientMessageId?: string }) => {
      const lastAttempt = async (): Promise<ChatSendResult> => {
        return api.sendChatMessage(conversationId, {
          text: input.text,
          send_as: sendAs,
          client_message_id: input.clientMessageId,
          idempotency_key: input.clientMessageId ? `ui-${input.clientMessageId}` : undefined
        });
      };
      let attempt = 0;
      while (true) {
        try {
          return await lastAttempt();
        } catch (err) {
          attempt++;
          if (!isTransientSendError(err) || attempt >= 3) throw err;
          await new Promise((r) => setTimeout(r, Math.min(1000 * Math.pow(2, attempt), 4000)));
        }
      }
    },
    onMutate: async (input) => {
      const messageId = input.clientMessageId ?? crypto.randomUUID();
      const queryKey = queryKeys.conversationMessages(conversationId);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ConversationMessagesResult>(queryKey);
      const createdAt = new Date().toISOString();
      const optimistic: TimelineMessage = sendAs === "file_request"
        ? {
          kind: "file_request",
          id: messageId,
          origin_side: "local",
          author_label: "You",
          task_id: messageId,
          requester: "You",
          target: "Peer",
          natural_language_request: input.text,
          query: input.text,
          status: "submitted",
          created_at: createdAt,
          details: {}
        }
        : {
          kind: "human",
          id: messageId,
          conversation_id: conversationId,
          sender_user_id: null,
          sender_agent_instance_id: null,
          receiver_agent_instance_id: null,
          direction: "outgoing",
          sender_label: "You",
          text: input.text,
          created_at: createdAt,
          delivery_status: "local_pending"
        };
      queryClient.setQueryData<ConversationMessagesResult>(queryKey, {
        conversationId,
        messages: [...(previous?.messages ?? []), optimistic],
        pageInfo: previous?.pageInfo,
        readState: previous?.readState ?? {
          conversationId,
          unreadCount: 0,
          mentionCount: 0
        }
      });
      return { previous, queryKey, messageId };
    },
    onError: (err, input, context) => {
      if (context?.queryKey) {
        const current = queryClient.getQueryData<ConversationMessagesResult>(context.queryKey);
        if (current) {
          queryClient.setQueryData<ConversationMessagesResult>(context.queryKey, {
            ...current,
            messages: current.messages.map((msg) =>
              msg.id === context.messageId && (msg.kind === "human" || msg.kind === "file_request")
                ? { ...msg, delivery_status: "failed" as const }
                : msg
            )
          });
        }
      }
      if (context?.messageId) {
        rememberQueuedMessageText(context.messageId, input.text);
        addToQueue({
          conversationId,
          clientMessageId: context.messageId,
          failedAt: new Date().toISOString(),
          failureReason: err && typeof err === "object" && "details" in err
            ? ((err as { details: Record<string, unknown> }).details?.relay_unavailable === true ? "relay_unavailable" : "unknown")
            : "timeout",
          textPreview: "[message content retained only in memory]"
        });
      }
    },
    onSettled: (result, _error, _input, context) => {
      if (result && context?.queryKey && context?.messageId) {
        const current = queryClient.getQueryData<ConversationMessagesResult>(context.queryKey);
        if (current) {
          queryClient.setQueryData<ConversationMessagesResult>(context.queryKey, {
            ...current,
            messages: current.messages.map((msg) =>
              msg.id === context.messageId && (msg.kind === "human" || msg.kind === "file_request")
                ? { ...msg, delivery_status: result.delivery_status, relay_task_id: result.relay_task_id ?? null }
                : msg
            )
          });
        }
      }
      if (context?.queryKey) void queryClient.invalidateQueries({ queryKey: context.queryKey });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    }
  });
}

export function usePendingApprovals() {
  const localSession = useLocalUiSession();
  const localSessionReady = isLocalUiSessionReady(localSession.status);
  const query = useQuery({
    queryKey: queryKeys.pendingApprovals,
    queryFn: api.pendingApprovals,
    enabled: localSessionReady,
    refetchInterval: localSessionReady ? 3000 : false
  });
  const approvalCards = useMemo<FileCandidateApprovalCard[]>(
    () => (query.data?.approvals ?? []).map(mapApproval),
    [query.data]
  );
  return { ...query, approvalCards };
}

export function useApproveFileRequest() {
  return useApprovalMutation(api.approve, "Request approved");
}

export function useRejectFileRequest() {
  return useApprovalMutation(api.reject, "Request rejected");
}

export function useSubmitApprovalFeedback() {
  return useApprovalMutation((id, feedback) => api.feedback(id, feedback ?? ""), "Feedback sent");
}

function useApprovalMutation(fn: (id: string, feedback?: string) => Promise<unknown>, successLabel: string) {
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
    onSuccess: () => { toast.success(successLabel); },
    onError: (_err) => { toast.danger(`Failed: ${(_err instanceof Error ? _err.message : "Unknown error")}`); },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pendingApprovals });
      void queryClient.invalidateQueries({ queryKey: queryKeys.auditEvents });
      void queryClient.invalidateQueries({ queryKey: queryKeys.receivedFiles });
    }
  });
}

export function useReceivedFiles() {
  const localSession = useLocalUiSession();
  const localSessionReady = isLocalUiSessionReady(localSession.status);
  return useQuery({ queryKey: queryKeys.receivedFiles, queryFn: api.files, enabled: localSessionReady, refetchInterval: localSessionReady ? 5000 : false });
}

export function useAuditEvents() {
  const localSession = useLocalUiSession();
  const localSessionReady = isLocalUiSessionReady(localSession.status);
  return useQuery({ queryKey: queryKeys.auditEvents, queryFn: api.audit, enabled: localSessionReady, refetchInterval: localSessionReady ? 7000 : false });
}

export function useAuditVerify() {
  return useQuery({ queryKey: queryKeys.auditVerify, queryFn: api.auditVerify, enabled: false });
}

export function useRegistryAgents(trustLevel?: RegistryTrustLevel) {
  return useQuery({
    queryKey: queryKeys.registryAgents(trustLevel ?? "all"),
    queryFn: () => api.registryAgents(trustLevel),
    refetchInterval: 10000
  });
}

export function useUpdateRegistryTrust() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { did: string; trustLevel: RegistryTrustLevel }) =>
      api.updateRegistryTrust(input.did, input.trustLevel),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["registry", "agents"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agentProfiles });
      void queryClient.invalidateQueries({ queryKey: queryKeys.trustGraph });
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    }
  });
}

export function useDiscoverRegistryAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.discoverRegistryAgent,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["registry", "agents"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agentProfiles });
      void queryClient.invalidateQueries({ queryKey: queryKeys.trustGraph });
    }
  });
}

export function useSkills() {
  return useQuery({ queryKey: queryKeys.skills, queryFn: api.skills, staleTime: 30000 });
}

export function useFileIndexRoots() {
  return useQuery({ queryKey: queryKeys.fileIndexRoots, queryFn: api.fileIndexRoots, refetchInterval: 15000 });
}

export function useVaultRoots() {
  return useQuery({ queryKey: ["files", "roots"], queryFn: fileIndexApi.getRoots, refetchInterval: 15000 });
}

export function useAddVaultRoot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { rootPath: string; displayName?: string }) => fileIndexApi.addRoot(input.rootPath, input.displayName),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["files", "roots"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.fileIndexRoots });
    }
  });
}

export function useRemoveVaultRoot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => fileIndexApi.removeRoot(id),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["files", "roots"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.fileIndexRoots });
      void queryClient.invalidateQueries({ queryKey: ["files", "indexed"] });
    }
  });
}

export function useVaultExcludes(rootPath?: string) {
  return useQuery({ queryKey: ["files", "excludes", rootPath], queryFn: () => fileIndexApi.getExcludes(rootPath), refetchInterval: 15000 });
}

export function useAddVaultExclude() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { rootPath: string; excludePath: string; excludeType?: "folder" | "pattern" }) => 
      fileIndexApi.addExclude(input.rootPath, input.excludePath, input.excludeType),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["files", "excludes"] });
    }
  });
}

export function useRemoveVaultExclude() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => fileIndexApi.removeExclude(id),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["files", "excludes"] });
    }
  });
}

export function useIndexedFiles(limit = 100, offset = 0, query = "", extension = "") {
  return useQuery({
    queryKey: queryKeys.indexedFiles(limit, offset, query, extension),
    queryFn: () => api.indexedFiles(limit, offset, query, extension),
    refetchInterval: 15000
  });
}

export function useRebindApprovalFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { approvalId: string; fileId: string }) => api.rebindFile(input.approvalId, input.fileId),
    onSuccess: () => {
      toast.success("File selected for approval");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pendingApprovals });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    }
  });
}

export function useFileSearch(query: string) {
  return useQuery({
    queryKey: queryKeys.fileSearch(query),
    queryFn: () => api.searchFiles(query),
    enabled: query.trim().length > 0,
    staleTime: 10000
  });
}

export function useIndexFileRoots() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (roots: string[]) => api.indexFileRoots(roots),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.fileIndexRoots });
      void queryClient.invalidateQueries({ queryKey: ["files", "indexed"] });
    }
  });
}

export function useReindexFiles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (roots: string[]) => api.reindexFiles(roots),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.fileIndexRoots });
      void queryClient.invalidateQueries({ queryKey: ["files", "indexed"] });
    }
  });
}

export function useTransfers() {
  return useQuery({ queryKey: queryKeys.transfers, queryFn: api.transfers, refetchInterval: 5000 });
}

export function useA2ATasks() {
  return useQuery({ queryKey: queryKeys.a2aTasks, queryFn: api.a2aTasks, refetchInterval: 5000 });
}

export function useA2ATask(taskId: string | null) {
  return useQuery({
    queryKey: queryKeys.a2aTask(taskId ?? "none"),
    queryFn: () => api.a2aTask(taskId ?? ""),
    enabled: Boolean(taskId),
    refetchInterval: 5000
  });
}

export function useA2ATaskEvents(taskId: string | null, enabled = true) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!taskId || !enabled) return;
    const transport = new SseTransport([
      {
        url: api.a2aTaskEventsUrl(taskId),
        eventName: "workflow_event",
        hydrate: (data, qc) => {
          const event = normalizeWorkflowEvent(data);
          if (!event) return;
          qc.setQueryData<{ events: WorkflowEvent[] }>(queryKeys.a2aTaskEvents(taskId), (current) => {
            const existing = current?.events ?? [];
            const key = event.id ?? `${event.eventType ?? event.event_type}-${event.createdAt ?? event.created_at}-${existing.length}`;
            const deduped = existing.filter((item) => {
              const itemKey = item.id ?? `${item.eventType ?? item.event_type}-${item.createdAt ?? item.created_at}`;
              return itemKey !== key;
            });
            return { events: [...deduped, event] };
          });
        },
        invalidate: [[...queryKeys.a2aTasks], [...queryKeys.a2aTask(taskId)]]
      }
    ], [
      { queryKey: [...queryKeys.a2aTasks], intervalMs: 5000 },
      { queryKey: [...queryKeys.a2aTask(taskId)], intervalMs: 5000 }
    ]);
    transport.start(queryClient);
    return () => transport.stop();
  }, [taskId, enabled, queryClient]);

  return useQuery({
    queryKey: queryKeys.a2aTaskEvents(taskId ?? "none"),
    queryFn: async () => ({ events: [] as WorkflowEvent[] }),
    enabled: Boolean(taskId) && enabled,
    staleTime: Infinity
  });
}

export function useAgentRuns() {
  return useQuery({ queryKey: queryKeys.agentRuns, queryFn: api.agentRuns, refetchInterval: 3000 });
}

export function useMemoryConversations() {
  return useQuery({ queryKey: queryKeys.memoryConversations, queryFn: () => api.memoryConversations(), refetchInterval: 15000 });
}

export function useMemoryWindow(conversationId: string | null) {
  return useQuery({
    queryKey: queryKeys.memoryWindow(conversationId ?? "none"),
    queryFn: () => api.memoryWindow(conversationId ?? ""),
    enabled: Boolean(conversationId),
    refetchInterval: 15000
  });
}

export function useEpisodicMemory(options: { taskId?: string; query?: string; limit?: number } = {}) {
  const key = options.taskId ?? options.query ?? "recent";
  return useQuery({
    queryKey: queryKeys.episodicMemory(key),
    queryFn: () => api.episodicMemory(options),
    refetchInterval: 15000
  });
}

export function useLongTermMemory(options: { namespace?: string; query?: string; limit?: number; offset?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.longTermMemory(options.namespace ?? "default", options.query ?? ""),
    queryFn: () => api.longTermMemory(options),
    refetchInterval: 30000
  });
}

export function usePolicySummary() {
  return useQuery({ queryKey: queryKeys.policySummary, queryFn: api.policySummary, refetchInterval: 30000 });
}

export function usePolicyRules() {
  return useQuery({ queryKey: queryKeys.policyRules, queryFn: api.policyRules, refetchInterval: 30000 });
}

export function useCreatePolicyRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.createPolicyRule,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.policyRules });
      void queryClient.invalidateQueries({ queryKey: queryKeys.policySummary });
    }
  });
}

export function useUpdatePolicyRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; rule: Parameters<typeof api.updatePolicyRule>[1] }) =>
      api.updatePolicyRule(input.id, input.rule),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.policyRules });
      void queryClient.invalidateQueries({ queryKey: queryKeys.policySummary });
    }
  });
}

export function useDeletePolicyRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.deletePolicyRule,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.policyRules });
      void queryClient.invalidateQueries({ queryKey: queryKeys.policySummary });
    }
  });
}

export function useEvaluatePolicyRule() {
  return useMutation({ mutationFn: api.evaluatePolicyRule });
}

export function useEvaluateCommandPolicy() {
  return useMutation({
    mutationFn: (input: { command: string; timeoutMs?: number }) => api.evaluateCommandPolicy(input)
  });
}

export function useUniversalSearch(query: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.universalSearch(query),
    queryFn: () => api.universalSearch(query, { limit: 30 }),
    enabled: enabled && query.trim().length > 0,
    staleTime: 5000
  });
}

export function useMissionThread(missionId: string | null) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!missionId) return;
    const source = new EventSource(api.missionThreadEventsUrl(missionId));
    const onMessage = (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data) as MissionThreadMessage;
        queryClient.setQueryData<{ messages: MissionThreadMessage[] }>(queryKeys.missionThread(missionId), (current) => {
          const existing = current?.messages ?? [];
          return { messages: [...existing.filter((item) => item.id !== message.id), message].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) };
        });
      } catch {
        // Ignore malformed event payloads; polling/query fetch remains the fallback.
      }
    };
    source.addEventListener("thread_message", onMessage);
    source.onerror = () => {
      source.close();
      void queryClient.invalidateQueries({ queryKey: queryKeys.missionThread(missionId) });
    };
    return () => source.close();
  }, [missionId, queryClient]);

  return useQuery({
    queryKey: queryKeys.missionThread(missionId ?? "none"),
    queryFn: () => api.missionThread(missionId ?? ""),
    enabled: Boolean(missionId),
    refetchInterval: 15000
  });
}

export function useCreateMissionThreadMessage(missionId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.createMissionThreadMessage(missionId ?? "", body),
    onSuccess: () => {
      if (missionId) void queryClient.invalidateQueries({ queryKey: queryKeys.missionThread(missionId) });
    }
  });
}

export function useRedactionPreview() {
  return useMutation({ mutationFn: api.redactionPreview });
}

export function useApplyRedaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.applyRedaction,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.auditEvents });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    }
  });
}

export function useNotifications() {
  return useQuery({ queryKey: queryKeys.notifications, queryFn: () => api.notifications(50), refetchInterval: 10000 });
}

export function useBiometricCapability() {
  return useQuery({
    queryKey: queryKeys.biometricCapability,
    queryFn: async () => {
      const server = await api.biometricCapability();
      const browserAvailable =
        typeof window !== "undefined" &&
        "PublicKeyCredential" in window &&
        typeof window.PublicKeyCredential === "function";
      return { ...server, available: browserAvailable, browserAvailable };
    },
    staleTime: 60000
  });
}

export function useInboxItems(params: InboxItemsParams) {
  return useQuery({
    queryKey: queryKeys.inboxItems(params),
    queryFn: () => api.inboxItems(params),
    placeholderData: keepPreviousData,
    refetchInterval: 5000
  });
}

export function useInboxItem(itemId: string | null) {
  return useQuery({
    queryKey: queryKeys.inboxItem(itemId ?? "none"),
    queryFn: () => api.inboxItem(itemId ?? ""),
    enabled: Boolean(itemId)
  });
}

export function useInboxItemAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, action, body }: { itemId: string; action: InboxServerAction; body?: Record<string, unknown> }) =>
      api.inboxAction(itemId, action, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.pendingApprovals });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      void queryClient.invalidateQueries({ queryKey: queryKeys.transfers });
      void queryClient.invalidateQueries({ queryKey: queryKeys.auditEvents });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agentRuns });
    }
  });
}

export function useClassifyIntent() {
  return useMutation({ mutationFn: (text: string) => api.classifyIntent(text) });
}

export function useRewriteIntent() {
  return useMutation({ mutationFn: (query: string) => api.rewriteIntent(query) });
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

export function useSignup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string; display_name: string; control_plane_url?: string }) =>
      api.signup(body),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.cloudStatus });
    }
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string; control_plane_url?: string }) =>
      api.login(body),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.cloudStatus });
    }
  });
}

const logoutProtectedQueryRoots = new Set([
  "current-profile",
  "directory",
  "contacts",
  "chat",
  "approvals",
  "files",
  "audit",
  "agent",
  "relay",
  "registry",
  "skills",
  "a2a",
  "memory",
  "policy",
  "missions",
  "consent",
  "trust",
  "inbox"
]);

function disconnectedCloudStatus(current: CloudStatus | undefined): CloudStatus | undefined {
  if (!current) return current;
  return {
    ...current,
    cloud: {
      ...current.cloud,
      orgId: null,
      userId: null,
      userEmail: null,
      displayName: null,
      deviceId: null,
      agentId: null,
      agentInstanceId: null,
      relayInboxUrl: null,
      status: "disconnected",
      hasUserAccessToken: false,
      hasDeviceAccessToken: false,
      hasRefreshToken: false,
      updatedAt: new Date().toISOString()
    },
    heartbeat: {
      ...current.heartbeat,
      running: false
    },
    inbox: {
      ...current.inbox,
      running: false
    },
    tokenIssue: null,
    canRecoverDeviceToken: false,
    userAuthIssue: null,
    canRecoverUserToken: false,
    localPublicKeyFingerprint: null
  };
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.removeQueries({
        predicate: (query) => logoutProtectedQueryRoots.has(String(query.queryKey[0] ?? ""))
      });
      queryClient.setQueryData<CloudStatus | undefined>(queryKeys.cloudStatus, disconnectedCloudStatus);
      void queryClient.invalidateQueries({ queryKey: queryKeys.cloudStatus });
      toast.success("Logged out");
    },
    onError: (err) => {
      toast.danger(`Logout failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  });
}

export function useResetDeviceIdentity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.resetDeviceIdentity,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.cloudStatus });
      toast.success("Local device identity reset");
    },
    onError: (err) => {
      toast.danger(`Reset failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  });
}

export function useAskRequester() {
  return useMutation({
    mutationFn: async (input: { conversationId: string; question: string }) => {
      return api.sendChatMessage(input.conversationId, {
        text: `[Ask requester] ${input.question}`,
        send_as: "file_request",
      });
    },
  });
}

export function useAgentRun(runId: string | null) {
  return useQuery({
    queryKey: queryKeys.agentRun(runId ?? "none"),
    queryFn: () => api.agentRun(runId ?? ""),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 1000;
      return data.status === "running" ? 1000 : false;
    }
  });
}

export function useMissions() {
  return useQuery({
    queryKey: queryKeys.missions,
    queryFn: api.missions,
    refetchInterval: 3000,
    select: (data) => data.missions
  });
}

export function useTaskMissionProjections() {
  const missionsQuery = useMissions();
  const tasksQuery = useA2ATasks();
  const projections = useMemo<TaskMissionProjection[]>(() => {
    const missions = missionsQuery.data ?? [];
    const missionTaskIds = new Set(missions.flatMap((mission) => mission.a2aTaskIds ?? []));
    const missionRows: TaskMissionProjection[] = missions.map((mission) => ({
      id: mission.id,
      title: mission.title,
      status: mission.status === "completed"
        ? "completed"
        : mission.status === "failed"
          ? "failed"
          : mission.status === "cancelled"
            ? "cancelled"
            : mission.status === "awaiting_approval"
              ? "waiting"
              : "running",
      source: "mission",
      owner: mission.recipientName || mission.requesterName || "Oracle Amigo",
      conversationId: mission.conversationId,
      controlTaskId: mission.a2aTaskIds?.[0] ?? (mission.source === "a2a" ? mission.id : null),
      riskLevel: mission.risk?.level ?? "unknown",
      updatedAt: mission.updatedAt,
      stepCount: mission.steps.length,
      message: mission.description
    }));
    const a2aRows: TaskMissionProjection[] = (tasksQuery.data?.tasks ?? [])
      .filter((task) => !missionTaskIds.has(task.id))
      .map((task) => ({
        id: task.id,
        title: String(task.metadata?.title ?? task.id),
        status: task.state === "completed"
          ? "completed"
          : task.state === "failed"
            ? "failed"
            : task.state === "cancelled"
              ? "cancelled"
              : "running",
        source: "a2a",
        owner: String(task.metadata?.owner ?? task.metadata?.recipientName ?? "Remote agent"),
        conversationId: typeof task.metadata?.conversationId === "string" ? task.metadata.conversationId : null,
        controlTaskId: task.id,
        riskLevel: "unknown",
        updatedAt: task.createdAt,
        stepCount: 0,
        message: task.status || task.state
      }));
    return [...missionRows, ...a2aRows].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }, [missionsQuery.data, tasksQuery.data?.tasks]);

  return {
    data: projections,
    isLoading: missionsQuery.isLoading || tasksQuery.isLoading,
    isError: missionsQuery.isError || tasksQuery.isError,
    refetch: async () => {
      await Promise.all([missionsQuery.refetch(), tasksQuery.refetch()]);
    }
  };
}

export function useVoiceCommands(limit = 50, offset = 0) {
  return useQuery({
    queryKey: queryKeys.voiceCommands,
    queryFn: () => api.voiceCommands(limit, offset),
    refetchInterval: 5000
  });
}

export function useVoiceCommand(commandId: string | null) {
  return useQuery({
    queryKey: queryKeys.voiceCommand(commandId ?? "none"),
    queryFn: () => api.voiceCommand(commandId!),
    enabled: Boolean(commandId),
    refetchInterval: (query) => {
      const status = query.state.data?.command?.status;
      return status === "running" || status === "submitted" || status === "confirmed" ? 1000 : false;
    }
  });
}

export function useCreateVoiceCommand() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.createVoiceCommand,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.voiceCommands });
      void queryClient.invalidateQueries({ queryKey: queryKeys.missions });
    }
  });
}

export function useConfirmVoiceCommand() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { commandId: string; idempotencyKey?: string }) => api.confirmVoiceCommand(input.commandId, { idempotency_key: input.idempotencyKey }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.voiceCommands });
      void queryClient.invalidateQueries({ queryKey: queryKeys.voiceCommand(data.command.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.missions });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    }
  });
}

export function useCancelVoiceCommand() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (commandId: string) => api.cancelVoiceCommand(commandId),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.voiceCommands });
      void queryClient.invalidateQueries({ queryKey: queryKeys.voiceCommand(data.command.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.missions });
    }
  });
}

export function useUserAgentSettings() {
  return useQuery({
    queryKey: queryKeys.userAgentSettings,
    queryFn: api.userAgentSettings,
    staleTime: 30000
  });
}

export function useUpdateUserAgentSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: UserAgentSettings) => api.updateUserAgentSettings(settings),
    onSuccess: () => {
      toast.success("Settings saved");
      void queryClient.invalidateQueries({ queryKey: queryKeys.userAgentSettings });
    },
    onError: (error) => {
      toast.danger(error instanceof Error ? error.message : "Failed to save settings");
    }
  });
}

/*
 * Legacy synthetic inbox triage was removed from the public hook surface.
 * The real intent inbox is server-backed through useInboxItems/useInboxItemAction.
function useInboxTriageLegacyDisabled() {
  const { approvalCards } = usePendingApprovals();
  const { data: convsData } = useConversations();
  const { data: filesData } = useReceivedFiles();
  const { data: transfersData } = useTransfers();
  const { data: auditData } = useAuditEvents();

  return useMemo<TriageGroup[]>(() => {
    const convs = convsData?.conversations ?? [];
    const files = filesData?.files ?? [];
    const transfers = transfersData?.transfers ?? [];
    const auditEvents = auditData?.events ?? [];

    const items: ActionableInboxItem[] = [
      ...approvalCards.slice(0, 4).map((card, index) => ({
        id: card.approval_id,
        type: "approval" as const,
        title: generateHumanReadableTitle({ request_text: card.request_text, status: card.status }),
        summary: `${card.candidates.length} candidate${card.candidates.length === 1 ? "" : "s"} • ${card.requester}`,
        requester: { id: card.approval_id, name: card.requester, owner: card.requester, trustBadge: { label: "Verified", tone: "green" as const } },
        risk: (index % 2 === 0 ? "medium" : "high") as "low" | "medium" | "high",
        sensitivity: (index % 3 === 0 ? "high" : "medium") as "low" | "medium" | "high" | "critical",
        actions: ["preview", "approve_once", "ask_why", "deny"] as ("preview" | "approve_once" | "redact_approve" | "ask_why" | "deny" | "revoke" | "snooze")[],
        trustBadge: { label: "Verified", tone: "green" as const },
        isLeavingDevice: true,
        expiresAt: card.expires_at,
        privacyMasked: false,
        auditPreview: auditEvents[index]?.eventType ?? "Audit preview ready",
        lastUpdated: new Date().toISOString(),
      })),
      ...files.slice(0, 3).map((file, index) => ({
        id: `file-${file.id}`,
        type: "mission" as const,
        title: `Vault item ${file.originalFileName}`,
        summary: `${file.sizeBytes} bytes • ${file.sha256.slice(0, 8)}`,
        requester: { id: file.id, name: "Local vault", owner: "Local vault", trustBadge: { label: "Local", tone: "blue" as const } },
        risk: (index % 2 === 0 ? "low" : "medium") as "low" | "medium" | "high",
        sensitivity: (index % 3 === 0 ? "high" : "medium") as "low" | "medium" | "high" | "critical",
        actions: ["preview", "redact_approve", "revoke"] as ("preview" | "approve_once" | "redact_approve" | "ask_why" | "deny" | "revoke" | "snooze")[],
        trustBadge: { label: "Local", tone: "blue" as const },
        isLeavingDevice: false,
        privacyMasked: false,
        auditPreview: "Stored and verified",
        lastUpdated: file.receivedAt,
      })),
      ...transfers.slice(0, 2).map((transfer, index) => ({
        id: `transfer-${String(transfer.id ?? transfer.transfer_id ?? index)}`,
        type: "risk_alert" as const,
        title: `Transfer ${String(transfer.file_name ?? transfer.fileName ?? "file")}`,
        summary: `${String(transfer.status ?? "transfer")} • ${String(transfer.transfer_id ?? "pending")}`,
        requester: { id: String(transfer.id ?? index), name: "Transfer service", owner: "Transfer service", trustBadge: { label: "Auto", tone: "amber" as const } },
        risk: (index === 0 ? "high" : "medium") as "low" | "medium" | "high",
        sensitivity: "critical" as "low" | "medium" | "high" | "critical",
        actions: ["preview", "deny", "snooze"] as ("preview" | "approve_once" | "redact_approve" | "ask_why" | "deny" | "revoke" | "snooze")[],
        trustBadge: { label: "Auto", tone: "amber" as const },
        isLeavingDevice: true,
        privacyMasked: false,
        auditPreview: "Transfer state tracked",
        lastUpdated: String(transfer.created_at ?? transfer.createdAt ?? new Date().toISOString()),
      }))
    ];

    return [
      { id: "needs_approval", label: "Needs my approval", icon: ShieldAlert, count: approvalCards.filter((card) => card.status === "pending").length, items: items.filter((item) => item.type === "approval"), priority: 1 },
      { id: "agent_working", label: "Agent working", icon: Bot, count: convs.filter((c) => (c.messages ?? []).some((m) => (m as { kind?: string }).kind === "agent_status")).length, items: items.filter((item) => item.type === "mission"), priority: 2 },
      { id: "waiting_on_others", label: "Waiting on others", icon: Clock3, count: convs.length, items: items.filter((item) => item.type === "risk_alert"), priority: 3 },
      { id: "risky", label: "Risky or sensitive", icon: AlertTriangle, count: items.filter((item) => item.risk === "high" || item.sensitivity === "critical").length, items: items.filter((item) => item.risk === "high" || item.sensitivity === "critical"), priority: 4 },
      { id: "completed", label: "Completed", icon: CheckCircle2, count: Math.max(0, items.length - 4), items: items.slice(0, 1), priority: 5 },
    ] as TriageGroup[];
  }, [approvalCards, convsData, filesData, transfersData, auditData]);
}
*/

export function usePauseMission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.pauseMission(taskId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.missions });
      void queryClient.invalidateQueries({ queryKey: queryKeys.a2aTasks });
    }
  });
}

export function useResumeMission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.resumeMission(taskId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.missions });
      void queryClient.invalidateQueries({ queryKey: queryKeys.a2aTasks });
    }
  });
}

export function useCancelMission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.cancelMission(taskId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.missions });
      void queryClient.invalidateQueries({ queryKey: queryKeys.a2aTasks });
    }
  });
}

export function useRetryMission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.retryMission(taskId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.missions });
      void queryClient.invalidateQueries({ queryKey: queryKeys.a2aTasks });
    }
  });
}

export function useConsent(consentId: string | null) {
  return useQuery({
    queryKey: queryKeys.consent(consentId ?? "none"),
    queryFn: async () => {
      const approvals = await api.pendingApprovals();
      const card = approvals.approvals?.find((a: Record<string, unknown>) =>
        String(a.id ?? a.approvalId ?? "") === consentId
      );
      if (!card) return null;
      const mapped = mapApproval(card);
      const candidate = mapped.candidates[0];
      return {
        id: mapped.approval_id,
        missionId: `mission-${mapped.approval_id}`,
        status: (mapped.status === "pending" ? "pending" :
                mapped.status === "approved" ? "granted" :
                mapped.status === "rejected" ? "rejected" :
                mapped.status === "expired" ? "expired" : "pending") as ConsentRecord["status"],
        requesterAgentId: mapped.requester,
        requesterDisplayName: mapped.requester.replace(/^ag[ei]_[a-f0-9-]{36,}$/i, "Remote agent"),
        purpose: mapped.request_text,
        fileName: candidate?.file_name ?? "Unknown file",
        filePath: candidate?.display_path ?? "Local path hidden",
        fileSizeBytes: candidate?.size_bytes ?? 0,
        fileSensitivity: "unknown" as const,
        matchConfidence: candidate?.match_score ?? 0,
        matchReason: candidate?.match_reason ?? "Search candidate",
        dataLeavingDevice: true,
        recipientAgentId: "",
        recipientAgentVerified: false,
        accessType: "one-time" as const,
        expiresAt: mapped.expires_at,
        revokedAt: null,
        policyApplied: candidate?.safety_labels ?? ["Approval required"],
        createdAt: mapped.approval_id,
        decidedAt: null,
      } as ConsentRecord;
    },
    enabled: Boolean(consentId),
  });
}

export function useConsentAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { consentId: string; action: "approve" | "reject" | "revoke"; accessType?: "one-time" | "time-bound" | "permanent"; expiresInHours?: number }) =>
      api.consentAction({
        consentId: input.consentId,
        action: input.action,
        accessType: input.accessType,
        expiresInHours: input.expiresInHours,
      }),
    onSuccess: (_data, input) => {
      const label = input.action === "approve" ? "Access approved" : input.action === "reject" ? "Access rejected" : "Access revoked";
      toast.success(label);
    },
    onError: (_err, input) => {
      const actionLabel = input.action === "approve" ? "approve" : input.action === "reject" ? "reject" : "revoke";
      toast.danger(`Failed to ${actionLabel}: ${(_err instanceof Error ? _err.message : "Unknown error")}`);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.missions });
      void queryClient.invalidateQueries({ queryKey: queryKeys.pendingApprovals });
    }
  });
}

export function useTrustGraph() {
  return useQuery({
    queryKey: queryKeys.trustGraph,
    queryFn: api.agentProfiles,
    refetchInterval: 10000,
    select: (data) => {
      const local = data.profiles.find((profile) => profile.trustLevel === "local") ?? data.profiles[0];
      return data.profiles
        .filter((profile) => profile.id !== local?.id)
        .map<TrustRelationship>((profile) => ({
          agentPairId: `${local?.id ?? "local-agent"}:${profile.id}`,
          localAgentInstanceId: local?.agentInstanceId ?? "local-agent",
          remoteAgentInstanceId: profile.agentInstanceId ?? profile.userId ?? profile.registryDid ?? profile.id,
          remoteAgentName: profile.displayName,
          remoteAgentOwnerName: profile.email ?? profile.displayName,
          trustLevel: profile.trustLevel,
          capabilities: profile.capabilities,
          permissionScope: profile.contactStatus === "accepted" ? "Contact accepted; approval still required for file sharing" : "Approval required before sharing",
          isBlocked: profile.trustLevel === "blocked" || profile.registryTrustLevel === "blocked",
          lastInteractionAt: profile.lastInteractionAt,
          requestCount: 0,
          createdAt: profile.presenceUpdatedAt ?? profile.lastInteractionAt ?? new Date(0).toISOString()
        }));
    }
  });
}

export function useRealtimePolling() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const fallback = [
      { queryKey: [...queryKeys.conversations], intervalMs: 10000 },
      { queryKey: [...queryKeys.pendingApprovals], intervalMs: 10000 },
      { queryKey: [...queryKeys.transfers], intervalMs: 15000 },
      { queryKey: [...queryKeys.missions], intervalMs: 15000 },
      { queryKey: [...queryKeys.cloudStatus], intervalMs: 15000 },
      { queryKey: [...queryKeys.voiceCommands], intervalMs: 15000 }
    ];
    const transport = new SseTransport("/events", fallback);
    transport.start(queryClient, (event) => {
      window.dispatchEvent(new CustomEvent("oa-realtime-event", { detail: event }));
    });
    return () => transport.stop();
  }, [queryClient]);
}

export function shouldRefetchActiveConversationRealtime(
  conversationId: string | null,
  event: { kind?: string; payload?: Record<string, unknown> } | undefined
): boolean {
  if (!conversationId) return false;
  if (event?.kind !== "conversation_update" && event?.kind !== "message_created") return false;
  const eventConversationId = event.payload?.conversationId;
  return eventConversationId === conversationId || eventConversationId === "*";
}

export function useActiveConversationRealtime(conversationId: string | null, refetchMessages: () => void | Promise<unknown>) {
  useEffect(() => {
    if (!conversationId) return;
    function handleRealtimeEvent(event: Event) {
      const detail = (event as CustomEvent<{ kind?: string; payload?: Record<string, unknown> }>).detail;
      if (!shouldRefetchActiveConversationRealtime(conversationId, detail)) return;
      void refetchMessages();
    }
    window.addEventListener("oa-realtime-event", handleRealtimeEvent);
    return () => window.removeEventListener("oa-realtime-event", handleRealtimeEvent);
  }, [conversationId, refetchMessages]);
}

export function useQueuedMessages(conversationId: string | null) {
  const queue = useQueueSnapshot();
  return useMemo(() => {
    if (!conversationId) return [];
    return queue.filter((q) => q.conversationId === conversationId);
  }, [conversationId, queue]);
}

export function useRetryQueued(conversationId: string) {
  const queryClient = useQueryClient();
  const sendMessage = useSendMessage(conversationId);
  return useCallback(async () => {
    const queue = getQueue().filter((q) => q.conversationId === conversationId);
    for (const msg of queue) {
      const text = queuedMessageText.get(msg.clientMessageId);
      if (!text) {
        removeFromQueue(conversationId, msg.clientMessageId);
        continue;
      }
      try {
        await sendMessage.mutateAsync({ text, clientMessageId: msg.clientMessageId });
        removeFromQueue(conversationId, msg.clientMessageId);
      } catch {
        // still failed - stays in queue
      }
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.conversationMessages(conversationId) });
  }, [conversationId, sendMessage, queryClient]);
}

export function useCancelQueued(conversationId: string) {
  const queryClient = useQueryClient();
  return useCallback(() => {
    clearConversationQueue(conversationId);
    void queryClient.invalidateQueries({ queryKey: queryKeys.conversationMessages(conversationId) });
  }, [conversationId, queryClient]);
}

export function useQueuedCount() {
  return useQueueSnapshot().length;
}
