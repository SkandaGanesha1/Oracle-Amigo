import type { ControlPlaneClient } from "./ControlPlaneClient.js";

export type PresenceStatus = "online" | "stale" | "offline" | "revoked";

export interface HeartbeatRequest {
  agent_instance_id: string;
  device_id?: string;
  agent_id?: string;
  version?: string;
  status: PresenceStatus;
  capabilities?: string[];
  agent_card_hash?: string;
  local_queue_depth?: number;
}

export interface HeartbeatResult {
  ok: boolean;
  server_time: string;
  next_heartbeat_seconds: number;
}

export class PresenceClient {
  constructor(private cp: ControlPlaneClient) {}

  heartbeat(req: HeartbeatRequest, deviceToken: string): Promise<HeartbeatResult> {
    return this.cp.postJson<HeartbeatResult>("/v1/presence/heartbeat", req, deviceToken);
  }
}
