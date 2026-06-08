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
  status: string;
  accepted_at: string;
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

  ack(relayTaskId: string, deviceToken: string): Promise<{ ok: boolean }> {
    return this.cp.postJson<{ ok: boolean }>(`/v1/relay/a2a/${encodeURIComponent(relayTaskId)}/ack`, {}, deviceToken);
  }

  respond(relayTaskId: string, response: Record<string, unknown>, deviceToken: string): Promise<{ ok: boolean }> {
    return this.cp.postJson<{ ok: boolean }>(`/v1/relay/a2a/${encodeURIComponent(relayTaskId)}/respond`, response, deviceToken);
  }

  getTask(relayTaskId: string, deviceToken: string): Promise<RelayInboxMessage & { response: Record<string, unknown> | null }> {
    return this.cp.getJson(`/v1/relay/a2a/tasks/${encodeURIComponent(relayTaskId)}`, deviceToken);
  }
}
