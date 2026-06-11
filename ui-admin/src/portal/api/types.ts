export interface AdminInfo {
  env: string;
  version: string;
  uptimeSeconds: number;
}

export interface AdminUser {
  id: string;
  org_id: string;
  email: string;
  display_name: string;
  status?: string;
  created_at: string;
  [key: string]: unknown;
}

export interface AdminDevice {
  id: string;
  org_id: string;
  user_id: string;
  agent_id?: string | null;
  device_name: string;
  status?: string;
  public_key_fingerprint?: string;
  created_at: string;
  owner_email?: string;
  org_slug?: string;
  [key: string]: unknown;
}

export interface AdminAgentInstance {
  id: string;
  org_id: string;
  agent_id: string;
  device_id: string;
  status?: string;
  created_at: string;
  agent_display_name?: string;
  device_name?: string;
  owner_email?: string;
  [key: string]: unknown;
}

export interface AdminPresence {
  id: number;
  org_id: string;
  user_id: string;
  device_id: string;
  status?: string;
  last_heartbeat_at: string;
  device_name?: string;
  owner_email?: string;
  [key: string]: unknown;
}

export interface AdminTask {
  id: number;
  org_id: string;
  from_agent_instance_id: string;
  to_agent_instance_id: string;
  status: string;
  created_at: string;
  completed_at?: string | null;
  [key: string]: unknown;
}

export interface AdminTransfer {
  id: number;
  org_id: string;
  from_agent_instance_id: string;
  to_agent_instance_id: string;
  file_name: string;
  file_size: number;
  sha256: string;
  status: string;
  expires_at: string;
  created_at: string;
  completed_at?: string | null;
  [key: string]: unknown;
}

export interface AdminAuditEvent {
  id: number;
  org_id: string;
  actor_user_id?: string | null;
  actor_agent_instance_id?: string | null;
  event_type: string;
  details_json: Record<string, unknown> | string;
  previous_hash: string;
  event_hash: string;
  created_at: string;
  [key: string]: unknown;
}

export interface AdminApproval {
  relay_task_id: string;
  org_id: string;
  from_agent_instance_id: string;
  to_agent_instance_id: string;
  a2a_task_id: string;
  type: string;
  task_status: string;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  [key: string]: unknown;
}

export interface AdminOrgSnapshot {
  organizations: Array<Record<string, unknown>>;
  users: AdminUser[];
  devices: AdminDevice[];
  agents: Array<Record<string, unknown>>;
  agent_instances: AdminAgentInstance[];
  presence: Array<Record<string, unknown>>;
  relay_tasks: AdminTask[];
  file_transfers: AdminTransfer[];
  audit_events: AdminAuditEvent[];
}

export type AdminPolicyAction = "allow" | "require_approval" | "deny";

export interface AdminPolicyRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  role: string;
  sensitivity: string;
  fileExtension: string;
  mimeType: string;
  transferDirection: string;
  maxFileSizeBytes: number | null;
  action: AdminPolicyAction;
  reason: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPolicyEvaluationInput {
  role?: string;
  sensitivity?: string;
  fileExtension?: string;
  mimeType?: string;
  transferDirection?: string;
  fileSizeBytes?: number;
}

export interface AdminPolicyEvaluation {
  action: AdminPolicyAction;
  reason: string;
  matchedRuleId: string | null;
  matchedRuleName: string | null;
}
