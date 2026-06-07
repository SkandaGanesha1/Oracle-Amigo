import type { ControlPlaneClient } from "./ControlPlaneClient.js";

export interface EnrollDeviceRequest {
  device_name: string;
  os?: string;
  os_version?: string;
  public_key: string;
  did?: string;
}

export interface EnrollAgentRequest {
  display_name: string;
  version?: string;
  capabilities?: string[];
  agent_card: Record<string, unknown>;
}

export interface EnrollRequest {
  device: EnrollDeviceRequest;
  agent: EnrollAgentRequest;
}

export interface EnrollResponse {
  org_id: string;
  user_id: string;
  device_id: string;
  agent_id: string;
  agent_instance_id: string;
  relay_inbox_id: string;
  relay_inbox_url: string;
  agent_card_url: string;
  device_access_token: string;
  refresh_token: string;
  expires_in: number;
}

export class EnrollmentClient {
  constructor(private cp: ControlPlaneClient) {}

  enroll(req: EnrollRequest, accessToken: string): Promise<EnrollResponse> {
    return this.cp.postJson<EnrollResponse>("/v1/enrollment/complete", req, accessToken);
  }

  listMyDevices(accessToken: string): Promise<{ devices: Array<Record<string, unknown>> }> {
    return this.cp.getJson("/v1/devices/me", accessToken);
  }

  listMyAgents(accessToken: string): Promise<{ agents: Array<Record<string, unknown>>; instances: Array<Record<string, unknown>> }> {
    return this.cp.getJson("/v1/agents/me", accessToken);
  }

  getAgentCard(agentInstanceId: string, deviceToken: string): Promise<Record<string, unknown>> {
    return this.cp.getJson(`/v1/agents/${encodeURIComponent(agentInstanceId)}/card`, deviceToken);
  }
}
