import type { ControlPlaneClient } from "./ControlPlaneClient.js";

export interface RelaySendRequest {
  to_agent_instance_id: string;
  a2a_task_id: string;
  type: string;
  payload: Record<string, unknown>;
  idempotency_key?: string;
  ttl_seconds?: number;
}

export interface RelaySendResult {
  relay_task_id: string;
  relay_message_id?: string;
  status: string;
  accepted_at: string;
  queued_at?: string | null;
}

export interface RelayInboxMessage {
  relay_task_id: string;
  relay_message_id?: string;
  from_agent_instance_id: string;
  to_agent_instance_id: string;
  a2a_task_id?: string;
  type: string;
  payload: Record<string, unknown>;
  status: string;
  created_at: string;
  delivered_at: string | null;
  ack_at: string | null;
}

export interface RelayInboxResult {
  items: RelayInboxMessage[];
  next_cursor: string | null;
  server_time?: string;
}

export interface RelayTaskStatusResult {
  id: string;
  orgId?: string;
  fromAgentInstanceId: string;
  toAgentInstanceId: string;
  a2aTaskId: string;
  type: string;
  payloadJson?: string;
  status:
    | "accepted"
    | "queued"
    | "delivered_to_remote_agent"
    | "stored_by_remote_agent"
    | "waiting_approval"
    | "approved"
    | "transfer_started"
    | "completed"
    | "failed"
    | "expired"
    | string;
  createdAt?: string;
  updatedAt?: string;
  acceptedAt?: string | null;
  queuedAt?: string | null;
  deliveredAt: string | null;
  storedAt?: string | null;
  completedAt: string | null;
  failedAt?: string | null;
  expiredAt?: string | null;
  expiresAt?: string | null;
  attemptCount?: number;
  maxAttempts?: number;
  lastError?: string | null;
  nextRetryAt?: string | null;
  response: Record<string, unknown> | null;
}

export class RelayClient {
  constructor(private cp: ControlPlaneClient) {}

  send(req: RelaySendRequest, deviceToken: string): Promise<RelaySendResult> {
    return this.cp.postJson<RelaySendResult>("/v1/relay/a2a/send", req, deviceToken);
  }

  async fetchInbox(opts: { limit?: number; cursor?: string | null }, deviceToken: string): Promise<RelayInboxResult> {
    const params = new URLSearchParams();
    if (opts.limit) params.set("limit", String(opts.limit));
    if (opts.cursor) params.set("cursor", opts.cursor);
    const qs = params.toString();
    const r = await this.cp.getJson<{ items: RelayInboxMessage[]; server_time: string }>(`/v1/relay/a2a/inbox${qs ? `?${qs}` : ""}`, deviceToken);
    return { items: r.items ?? [], next_cursor: null, server_time: r.server_time };
  }

  ack(relayTaskId: string, deviceToken: string): Promise<{ ok: boolean; status?: string }> {
    return this.cp.postJson<{ ok: boolean; status?: string }>(`/v1/relay/a2a/${encodeURIComponent(relayTaskId)}/ack`, {}, deviceToken);
  }

  respond(relayTaskId: string, response: Record<string, unknown>, deviceToken: string): Promise<{ ok: boolean; status?: string }> {
    return this.cp.postJson<{ ok: boolean; status?: string }>(`/v1/relay/a2a/${encodeURIComponent(relayTaskId)}/respond`, { payload: response }, deviceToken);
  }

  getTask(relayTaskId: string, deviceToken: string): Promise<RelayTaskStatusResult> {
    return this.cp.getJson(`/v1/relay/a2a/tasks/${encodeURIComponent(relayTaskId)}`, deviceToken);
  }
}
