export type * from "../types";

import type { CloudStatus } from "../types";

export interface CreateConversationRequest {
  peer_user_id?: string | null;
  peer_agent_instance_id?: string | null;
  title: string;
  mode?: "local" | "cloud_relay" | "loopback";
}

export interface ChatSendRequest {
  text: string;
  send_as: "normal" | "file_request";
  idempotency_key?: string;
  client_message_id?: string;
}

export interface ChatSendResult {
  ok: boolean;
  conversation_id: string;
  message_id: string;
  relay_task_id?: string;
  task_id?: string;
  type: "message" | "file_request" | "approval_required";
  delivery_status: "local_pending" | "sent" | "delivered" | "failed";
}

export interface AgentDiagnostics {
  health: { status: string; dryRun: boolean };
  cloud: CloudStatus;
  relayInbox: { running: boolean; lastItemCount: number; lastError: string | null };
}
