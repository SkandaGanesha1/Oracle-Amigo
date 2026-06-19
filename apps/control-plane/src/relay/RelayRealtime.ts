import type { AgentInstanceId, OrgId } from "../types/cloud.js";

export type RelayRealtimeEventKind =
  | "relay_message_available"
  | "relay_task_updated"
  | "relay_task_failed"
  | "relay_task_expired";

export interface RelayRealtimeEvent {
  kind: RelayRealtimeEventKind;
  org_id: OrgId;
  agent_instance_id: AgentInstanceId;
  relay_task_id: string;
  status: string;
  timestamp: string;
  payload?: Record<string, unknown>;
}

export interface RelayRealtimeSubscription {
  close(): void;
}

export interface RelayRealtime {
  readonly kind: "noop" | "sse" | "websocket";
  publish(event: RelayRealtimeEvent): Promise<void>;
  subscribe(
    orgId: OrgId,
    agentInstanceId: AgentInstanceId,
    onEvent: (event: RelayRealtimeEvent) => void
  ): RelayRealtimeSubscription;
}

export class NoopRelayRealtime implements RelayRealtime {
  readonly kind = "noop" as const;

  async publish(_event: RelayRealtimeEvent): Promise<void> {
    // Polling is the active transport. This seam is for future SSE/WebSocket fanout.
  }

  subscribe(): RelayRealtimeSubscription {
    return { close() {} };
  }
}
