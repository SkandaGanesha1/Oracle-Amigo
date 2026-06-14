import type { AgentRunResult, ChatDiagnostics, ChatSendRequest, ChatSendResult, ChatThreadResult, Conversation, ConversationMessagesResult, ConversationReadState, CreateConversationRequest, TimelineMessage } from "./types";
import { localAgentClient } from "./localAgentClient";

export const chatApi = {
  conversations: () => localAgentClient.get<{ conversations: Conversation[] }>("/chat/conversations"),
  createConversation: (body: CreateConversationRequest) =>
    localAgentClient.post<{ conversation: Conversation }>("/chat/conversations", body),
  messages: (conversationId: string, options?: { around?: string; before?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (options?.around) params.set("around", options.around);
    if (options?.before) params.set("before", options.before);
    if (options?.limit) params.set("limit", String(options.limit));
    const suffix = params.toString() ? `?${params}` : "";
    return localAgentClient.get<ConversationMessagesResult>(`/chat/conversations/${encodeURIComponent(conversationId)}/messages${suffix}`);
  },
  updateReadState: (conversationId: string, lastReadMessageId: string) =>
    localAgentClient.post<{ readState: ConversationReadState }>(
      `/chat/conversations/${encodeURIComponent(conversationId)}/read-state`,
      { lastReadMessageId }
    ),
  send: (conversationId: string, body: ChatSendRequest) =>
    localAgentClient.post<ChatSendResult>(`/chat/conversations/${encodeURIComponent(conversationId)}/messages`, body),
  pinMessage: (conversationId: string, messageId: string, pinned: boolean) =>
    localAgentClient.patch<{ message: TimelineMessage | null }>(
      `/chat/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/pin`,
      { pinned }
    ),
  thread: (conversationId: string, threadId: string) =>
    localAgentClient.get<ChatThreadResult>(`/chat/conversations/${encodeURIComponent(conversationId)}/threads/${encodeURIComponent(threadId)}`),
  createThreadReply: (conversationId: string, threadId: string, text: string) =>
    localAgentClient.post<{ message: TimelineMessage }>(
      `/chat/conversations/${encodeURIComponent(conversationId)}/threads/${encodeURIComponent(threadId)}/replies`,
      { text }
    ),
  diagnostics: () => localAgentClient.get<ChatDiagnostics>("/chat/diagnostics"),
  createAgentRun: (body: { query: string; createSandboxSession?: boolean }) =>
    localAgentClient.post<AgentRunResult>("/agent/runs", body),
  agentRuns: () =>
    localAgentClient.get<{ runs: AgentRunResult[] }>("/agent/runs"),
  agentRun: (runId: string) =>
    localAgentClient.get<AgentRunResult>(`/agent/runs/${encodeURIComponent(runId)}`),
  agentRunEventsUrl: (runId: string) => `/agent/runs/${encodeURIComponent(runId)}/events`,
  localChat: (text: string) =>
    localAgentClient.post<{
      ok: boolean;
      conversationId: string;
      type: "chat" | "approval_required";
      text?: string;
      taskId?: string;
      approvalId?: string;
      candidates?: Array<{
        id: number;
        fileName: string;
        displayPath: string;
        extension: string;
        sizeBytes: number;
        modifiedAt: string;
        score: number;
        reason: string;
      }>;
    }>("/chat/messages", { text })
};
