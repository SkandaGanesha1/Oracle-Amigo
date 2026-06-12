import type { ControlPlaneClient } from "./ControlPlaneClient.js";

export interface CloudUserSummary {
  user_id: string;
  email: string;
  display_name: string;
  status: string;
  presence?: string;
  active_agent_instances: number;
  agents?: CloudAgentInstance[];
}

export interface CloudAgentInstance {
  agent_instance_id: string;
  agent_id: string;
  device_id: string;
  display_name: string;
  device_name?: string;
  status: string;
  capabilities?: string[];
  relay_inbox_url: string;
  agent_card_url: string;
  agent_card_hash: string;
  last_seen_at: string | null;
  last_heartbeat_at?: string | null;
}

export interface CloudAgentInstanceDirectoryEntry extends CloudAgentInstance {
  user_id: string;
  email: string;
}

export interface CloudUserAgents {
  user_id: string;
  display_name: string;
  email: string;
  status: string;
  presence: string;
  active_agent_instances: number;
  agents: CloudAgentInstance[];
}

export interface CloudContact {
  id: string;
  org_id: string;
  requester_user_id: string;
  target_user_id: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export class DirectoryClient {
  constructor(private cp: ControlPlaneClient) {}

  searchUsers(query: string, accessToken: string): Promise<{ users: CloudUserSummary[] }> {
    const qs = new URLSearchParams({ q: query }).toString();
    return this.cp.getJson(`/v1/directory/users?${qs}`, accessToken);
  }

  getUserAgents(userId: string, accessToken: string): Promise<CloudUserAgents> {
    return this.cp.getJson(`/v1/directory/users/${encodeURIComponent(userId)}/agents`, accessToken);
  }

  getUserAgentsWithDevice(userId: string, deviceToken: string): Promise<CloudUserAgents> {
    return this.cp.getJson(`/v1/directory/device/users/${encodeURIComponent(userId)}/agents`, deviceToken);
  }

  getAgentInstance(agentInstanceId: string, accessToken: string): Promise<CloudAgentInstanceDirectoryEntry> {
    return this.cp.getJson(`/v1/directory/agent-instances/${encodeURIComponent(agentInstanceId)}`, accessToken);
  }

  getAgentInstanceWithDevice(agentInstanceId: string, deviceToken: string): Promise<CloudAgentInstanceDirectoryEntry> {
    return this.cp.getJson(`/v1/directory/device/agent-instances/${encodeURIComponent(agentInstanceId)}`, deviceToken);
  }

  listContacts(accessToken: string): Promise<{ contacts: CloudContact[] }> {
    return this.cp.getJson("/v1/contacts", accessToken);
  }

  requestContact(targetUserId: string, accessToken: string): Promise<CloudContact> {
    return this.cp.postJson<CloudContact>("/v1/contacts/request", { target_user_id: targetUserId }, accessToken);
  }

  acceptContact(contactId: string, accessToken: string): Promise<CloudContact> {
    return this.cp.postJson<CloudContact>(`/v1/contacts/${encodeURIComponent(contactId)}/accept`, {}, accessToken);
  }
}
