import type { ControlPlaneClient } from "./ControlPlaneClient.js";

export interface CloudUserSummary {
  user_id: string;
  email: string;
  display_name: string;
  status: string;
  active_agent_instances: number;
}

export interface CloudAgentInstance {
  agent_instance_id: string;
  agent_id: string;
  device_id: string;
  display_name: string;
  status: string;
  relay_inbox_url: string;
  last_seen_at: string | null;
}

export class DirectoryClient {
  constructor(private cp: ControlPlaneClient) {}

  searchUsers(query: string, accessToken: string): Promise<{ users: CloudUserSummary[] }> {
    const qs = new URLSearchParams({ q: query }).toString();
    return this.cp.getJson(`/v1/directory/users?${qs}`, accessToken);
  }

  getUserAgents(userId: string, accessToken: string): Promise<{ user_id: string; agents: CloudAgentInstance[] }> {
    return this.cp.getJson(`/v1/directory/users/${encodeURIComponent(userId)}/agents`, accessToken);
  }
}
