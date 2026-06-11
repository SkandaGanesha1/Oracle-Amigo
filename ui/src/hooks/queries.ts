import { useEffect, useMemo, useCallback, useSyncExternalStore } from "react";
import { AlertTriangle, Bot, CheckCircle2, Clock3, ShieldAlert } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, mapApproval } from "../api/client";
import { fileIndexApi } from "../api/client";
import type { ChatSendRequest, ChatSendResult, Conversation, CreateConversationRequest, FileCandidateApprovalCard, RegistryTrustLevel, TimelineMessage, ConsentRecord, WorkflowEvent, CloudStatus, MissionThreadMessage, PolicyRule } from "../api/types";
import type { ActionableInboxItem, TriageGroup, UniversalSearchResult } from "../types/agentic";
import { generateHumanReadableTitle } from "../lib/agentic-utils";
import { RealtimeLifecycle, SseTransport } from "../realtime/RealtimeTransport";
import { toast } from "../components/primitives/OracleToast";

const QUEUE_KEY = "oa-queued-messages";
const queueListeners = new Set<() => void>();

interface QueuedMessage {
  conversationId: string;
  text: string;
  clientMessageId: string;
  failedAt: string;
  failureReason: string;
}

function getQueue(): QueuedMessage[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
  } catch { return []; }
}

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
      return JSON.parse(snapshot) as QueuedMessage[];
    } catch {
      return [];
    }
  }, [snapshot]);
}

function addToQueue(msg: QueuedMessage): void {
  const queue = getQueue().filter((q) => q.clientMessageId !== msg.clientMessageId);
  queue.push(msg);
  setQueue(queue);
}

function removeFromQueue(conversationId: string, clientMessageId: string): void {
  setQueue(getQueue().filter((q) => !(q.conversationId === conversationId && q.clientMessageId === clientMessageId)));
}

function clearConversationQueue(conversationId: string): void {
  setQueue(getQueue().filter((q) => q.conversationId !== conversationId));
}

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
  auditVerify: ["audit", "verify"] as const,
  diagnostics: ["agent", "diagnostics"] as const,
  relayInbox: ["relay", "inbox-status"] as const,
  registryAgents: (trustLevel = "all") => ["registry", "agents", trustLevel] as const,
  skills: ["skills"] as const,
  fileIndexRoots: ["files", "index-roots"] as const,
  indexedFiles: (limit = 100, offset = 0) => ["files", "indexed", limit, offset] as const,
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
  consent: (id: string) => ["consent", id] as const,
  trustGraph: ["trust", "graph"] as const
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
  return useQuery({
    queryKey: queryKeys.conversations,
    queryFn: api.conversations,
    refetchInterval: 3000,
    select: (data) => {
      const seen = new Map<string, Conversation>();
      for (const conv of data.conversations ?? []) {
        const norm = conv.agentInstanceId ?? conv.title.trim().toLowerCase().replace(/\s+/g, " ");
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
      const previous = queryClient.getQueryData<{ conversationId: string; messages: TimelineMessage[] }>(queryKey);
      const optimistic: TimelineMessage = {
        kind: "human",
        id: messageId,
        conversation_id: conversationId,
        sender_user_id: null,
        sender_agent_instance_id: null,
        receiver_agent_instance_id: null,
        direction: "outgoing",
        sender_label: "You",
        text: input.text,
        created_at: new Date().toISOString(),
        delivery_status: "local_pending"
      };
      queryClient.setQueryData<{ conversationId: string; messages: TimelineMessage[] }>(queryKey, {
        conversationId,
        messages: [...(previous?.messages ?? []), optimistic]
      });
      return { previous, queryKey, messageId };
    },
    onError: (err, input, context) => {
      if (context?.queryKey) {
        const current = queryClient.getQueryData<{ conversationId: string; messages: TimelineMessage[] }>(context.queryKey);
        if (current) {
          queryClient.setQueryData<{ conversationId: string; messages: TimelineMessage[] }>(context.queryKey, {
            conversationId: current.conversationId,
            messages: current.messages.map((msg) =>
              msg.id === context.messageId && msg.kind === "human"
                ? { ...msg, delivery_status: "failed" as const }
                : msg
            )
          });
        }
      }
      if (context?.messageId) {
        addToQueue({
          conversationId,
          text: input.text,
          clientMessageId: context.messageId,
          failedAt: new Date().toISOString(),
          failureReason: err && typeof err === "object" && "details" in err
            ? ((err as { details: Record<string, unknown> }).details?.relay_unavailable === true ? "relay_unavailable" : "unknown")
            : "timeout"
        });
      }
    },
    onSettled: (result, _error, _input, context) => {
      if (result && context?.queryKey && context?.messageId) {
        const current = queryClient.getQueryData<{ conversationId: string; messages: TimelineMessage[] }>(context.queryKey);
        if (current) {
          queryClient.setQueryData<{ conversationId: string; messages: TimelineMessage[] }>(context.queryKey, {
            conversationId: current.conversationId,
            messages: current.messages.map((msg) =>
              msg.id === context.messageId && msg.kind === "human"
                ? { ...msg, delivery_status: result.delivery_status }
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
  const query = useQuery({ queryKey: queryKeys.pendingApprovals, queryFn: api.pendingApprovals, refetchInterval: 3000 });
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
  return useQuery({ queryKey: queryKeys.receivedFiles, queryFn: api.files, refetchInterval: 5000 });
}

export function useAuditEvents() {
  return useQuery({ queryKey: queryKeys.auditEvents, queryFn: api.audit, refetchInterval: 7000 });
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
    }
  });
}

export function useDiscoverRegistryAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.discoverRegistryAgent,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["registry", "agents"] });
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

export function useIndexedFiles(limit = 100, offset = 0) {
  return useQuery({
    queryKey: queryKeys.indexedFiles(limit, offset),
    queryFn: () => api.indexedFiles(limit, offset),
    refetchInterval: 15000
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
  "trust"
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

export function useInboxTriage() {
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
    queryFn: api.trustGraph,
    refetchInterval: 10000,
    select: (data) => data.relationships
  });
}

export function useRealtimePolling() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const transport = new RealtimeLifecycle([
      { queryKey: [...queryKeys.conversations], intervalMs: 3000 },
      { queryKey: [...queryKeys.contacts], intervalMs: 3000 },
      { queryKey: [...queryKeys.relayInbox], intervalMs: 3000 },
      { queryKey: [...queryKeys.pendingApprovals], intervalMs: 3000 },
      { queryKey: [...queryKeys.transfers], intervalMs: 5000 },
      { queryKey: [...queryKeys.a2aTasks], intervalMs: 5000 },
      { queryKey: [...queryKeys.agentRuns], intervalMs: 5000 },
      { queryKey: [...queryKeys.auditEvents], intervalMs: 7000 },
      { queryKey: [...queryKeys.missions], intervalMs: 3000 },
      { queryKey: [...queryKeys.trustGraph], intervalMs: 10000 },
      { queryKey: [...queryKeys.cloudStatus], intervalMs: 10000 }
    ]);
    transport.start(queryClient);
    return () => transport.stop();
  }, [queryClient]);
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
      try {
        await sendMessage.mutateAsync({ text: msg.text, clientMessageId: msg.clientMessageId });
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
