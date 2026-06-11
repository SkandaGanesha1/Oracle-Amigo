import type {
  EpisodicMemoryEvent,
  LongTermMemoryEntry,
  MemoryConversationSummary,
  MemoryWindowEntry,
} from "./types";
import { localAgentClient } from "./localAgentClient";

function params(values: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const raw = search.toString();
  return raw ? `?${raw}` : "";
}

export const memoryApi = {
  conversations: (limit = 25, offset = 0) =>
    localAgentClient.get<{ conversations: MemoryConversationSummary[]; limit: number; offset: number }>(
      `/memory/conversations${params({ limit, offset })}`
    ),
  window: (conversationId: string, options: { maxChars?: number; maxMessages?: number } = {}) =>
    localAgentClient.get<{
      conversationId: string;
      messages: MemoryWindowEntry[];
      maxChars: number;
      maxMessages: number;
    }>(`/memory/conversations/${encodeURIComponent(conversationId)}/window${params(options)}`),
  episodic: (options: { taskId?: string; query?: string; limit?: number } = {}) =>
    localAgentClient.get<{ events: EpisodicMemoryEvent[]; limit: number }>(`/memory/episodic${params(options)}`),
  longTerm: (options: { namespace?: string; query?: string; limit?: number; offset?: number } = {}) =>
    localAgentClient.get<{
      namespace: string;
      memories: LongTermMemoryEntry[];
      limit: number;
      offset: number;
    }>(`/memory/long-term${params(options)}`),
};
