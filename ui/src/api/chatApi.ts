import type { AgentRunResult, ChatDiagnostics, ChatSendRequest, ChatSendResult, Conversation, CreateConversationRequest, TimelineMessage } from "./types";
import { localAgentClient } from "./localAgentClient";

export const chatApi = {
  conversations: () => localAgentClient.get<{ conversations: Conversation[] }>("/chat/conversations"),
  createConversation: (body: CreateConversationRequest) =>
    localAgentClient.post<{ conversation: Conversation }>("/chat/conversations", body),
  messages: (conversationId: string) =>
    localAgentClient.get<{ conversationId: string; messages: TimelineMessage[] }>(`/chat/conversations/${encodeURIComponent(conversationId)}/messages`),
  send: (conversationId: string, body: ChatSendRequest) =>
    localAgentClient.post<ChatSendResult>(`/chat/conversations/${encodeURIComponent(conversationId)}/messages`, body),
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
