import { localAgentClient } from "./localAgentClient";

export const relayApi = {
  sendMessage: (body: { to_agent_instance_id: string; text: string; a2a_task_id?: string; idempotency_key?: string; conversation_id?: string; message_id?: string }) =>
    localAgentClient.post<{ relay_task_id: string; status: string }>("/relay/send-message", body),
  sendFileRequest: (body: { to_agent_instance_id: string; text: string; a2a_task_id?: string; idempotency_key?: string; conversation_id?: string; message_id?: string }) =>
    localAgentClient.post<{ relay_task_id: string; status: string }>("/relay/send-file-request", body),
  inboxStatus: () => localAgentClient.get<{
    running: boolean;
    lastItemCount: number;
    lastError: string | null;
    lastPollAt?: string | null;
    lastDispatchedCount?: number;
    dispatchCounter?: number;
  }>("/relay/inbox/status")
};
