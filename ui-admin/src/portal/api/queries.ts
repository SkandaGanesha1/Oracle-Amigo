import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { adminFetch } from "./client";
import type {
  AdminAgentInstance,
  AdminApproval,
  AdminAuditEvent,
  AdminDevice,
  AdminInfo,
  AdminOrgSnapshot,
  AdminPolicyAction,
  AdminPolicyEvaluation,
  AdminPolicyEvaluationInput,
  AdminPolicyRule,
  AdminPresence,
  AdminTask,
  AdminTransfer,
  AdminUser
} from "./types";

export type {
  AdminAgentInstance,
  AdminApproval,
  AdminAuditEvent,
  AdminDevice,
  AdminInfo,
  AdminOrgSnapshot,
  AdminPolicyAction,
  AdminPolicyEvaluation,
  AdminPolicyEvaluationInput,
  AdminPolicyRule,
  AdminPresence,
  AdminTask,
  AdminTransfer,
  AdminUser
};

async function fetchUsers(): Promise<AdminUser[]> {
  const body = await adminFetch<{ users: AdminUser[] }>("/v1/admin/users");
  return body.users ?? [];
}

async function fetchDevices(): Promise<AdminDevice[]> {
  const body = await adminFetch<{ devices: AdminDevice[] }>("/v1/admin/devices");
  return body.devices ?? [];
}

async function fetchAgentInstances(): Promise<AdminAgentInstance[]> {
  const body = await adminFetch<{ instances: AdminAgentInstance[] }>("/v1/admin/agent-instances");
  return body.instances ?? [];
}

async function fetchPresence(): Promise<AdminPresence[]> {
  const body = await adminFetch<{ presence: AdminPresence[] }>("/v1/admin/presence");
  return body.presence ?? [];
}

async function fetchTasks(): Promise<AdminTask[]> {
  const body = await adminFetch<{ tasks: AdminTask[] }>("/v1/admin/tasks");
  return body.tasks ?? [];
}

async function fetchTransfers(): Promise<AdminTransfer[]> {
  const body = await adminFetch<{ transfers: AdminTransfer[] }>("/v1/admin/transfers");
  return body.transfers ?? [];
}

async function fetchAudit(): Promise<AdminAuditEvent[]> {
  const body = await adminFetch<{ events: AdminAuditEvent[] }>("/v1/admin/audit");
  return body.events ?? [];
}

async function fetchApprovals(): Promise<AdminApproval[]> {
  const body = await adminFetch<{ approvals: AdminApproval[] }>("/v1/admin/approvals");
  return body.approvals ?? [];
}

async function fetchPolicyRules(): Promise<AdminPolicyRule[]> {
  const body = await adminFetch<{ rules: AdminPolicyRule[] }>("/policy/rules");
  return body.rules ?? [];
}

async function fetchOrgSnapshot(orgId: string): Promise<AdminOrgSnapshot> {
  return adminFetch<AdminOrgSnapshot>(`/v1/admin/orgs/${encodeURIComponent(orgId)}/snapshot`);
}

export function fetchAdminInfo(): Promise<AdminInfo> {
  return adminFetch<AdminInfo>("/v1/admin/info");
}

export function useAdminUsers(opts?: { refetchInterval?: number }): UseQueryResult<AdminUser[]> {
  return useQuery({
    queryKey: ["admin", "users"],
    queryFn: fetchUsers,
    refetchInterval: opts?.refetchInterval
  });
}

export function useAdminDevices(opts?: { refetchInterval?: number }): UseQueryResult<AdminDevice[]> {
  return useQuery({
    queryKey: ["admin", "devices"],
    queryFn: fetchDevices,
    refetchInterval: opts?.refetchInterval
  });
}

export function useAdminAgentInstances(opts?: { refetchInterval?: number }): UseQueryResult<AdminAgentInstance[]> {
  return useQuery({
    queryKey: ["admin", "agent-instances"],
    queryFn: fetchAgentInstances,
    refetchInterval: opts?.refetchInterval
  });
}

export function useAdminPresence(opts?: { refetchInterval?: number }): UseQueryResult<AdminPresence[]> {
  return useQuery({
    queryKey: ["admin", "presence"],
    queryFn: fetchPresence,
    refetchInterval: opts?.refetchInterval
  });
}

export function useAdminTasks(opts?: { refetchInterval?: number }): UseQueryResult<AdminTask[]> {
  return useQuery({
    queryKey: ["admin", "tasks"],
    queryFn: fetchTasks,
    refetchInterval: opts?.refetchInterval
  });
}

export function useAdminTransfers(opts?: { refetchInterval?: number }): UseQueryResult<AdminTransfer[]> {
  return useQuery({
    queryKey: ["admin", "transfers"],
    queryFn: fetchTransfers,
    refetchInterval: opts?.refetchInterval
  });
}

export function useAdminAudit(opts?: { refetchInterval?: number }): UseQueryResult<AdminAuditEvent[]> {
  return useQuery({
    queryKey: ["admin", "audit"],
    queryFn: fetchAudit,
    refetchInterval: opts?.refetchInterval
  });
}

export function useAdminApprovals(opts?: { refetchInterval?: number }): UseQueryResult<AdminApproval[]> {
  return useQuery({
    queryKey: ["admin", "approvals"],
    queryFn: fetchApprovals,
    refetchInterval: opts?.refetchInterval
  });
}

export function useAdminPolicyRules(opts?: { refetchInterval?: number }): UseQueryResult<AdminPolicyRule[]> {
  return useQuery({
    queryKey: ["admin", "policy-rules"],
    queryFn: fetchPolicyRules,
    refetchInterval: opts?.refetchInterval
  });
}

export function useCreateAdminPolicyRule(): UseMutationResult<AdminPolicyRule, Error, Partial<AdminPolicyRule> & { name: string; action: AdminPolicyRule["action"] }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => adminFetch<AdminPolicyRule>("/policy/rules", { method: "POST", body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "policy-rules"] });
    }
  });
}

export function useUpdateAdminPolicyRule(): UseMutationResult<AdminPolicyRule, Error, { id: string; patch: Partial<AdminPolicyRule> & { name: string; action: AdminPolicyRule["action"] } }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) => adminFetch<AdminPolicyRule>(`/policy/rules/${encodeURIComponent(id)}`, { method: "PUT", body: patch }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "policy-rules"] });
    }
  });
}

export function useDeleteAdminPolicyRule(): UseMutationResult<{ ok: boolean; id: string }, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => adminFetch<{ ok: boolean; id: string }>(`/policy/rules/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "policy-rules"] });
    }
  });
}

export function useEvaluateAdminPolicy(): UseMutationResult<AdminPolicyEvaluation, Error, AdminPolicyEvaluationInput> {
  return useMutation({
    mutationFn: (body) => adminFetch<AdminPolicyEvaluation>("/policy/evaluate", { method: "POST", body })
  });
}

export function useRevokeDevice(): UseMutationResult<{ ok: boolean; device_id: string; status: string }, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deviceId: string) => adminFetch<{ ok: boolean; device_id: string; status: string }>(
      `/v1/admin/devices/${encodeURIComponent(deviceId)}/revoke`,
      { method: "POST", body: {} }
    ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "devices"] });
      void qc.invalidateQueries({ queryKey: ["admin", "agent-instances"] });
      void qc.invalidateQueries({ queryKey: ["admin", "presence"] });
      void qc.invalidateQueries({ queryKey: ["admin", "audit"] });
    }
  });
}

export function useDisableUser(): UseMutationResult<{ ok: boolean; user_id: string; status: string }, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => adminFetch<{ ok: boolean; user_id: string; status: string }>(
      `/v1/admin/users/${encodeURIComponent(userId)}/disable`,
      { method: "POST", body: {} }
    ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "users"] });
      void qc.invalidateQueries({ queryKey: ["admin", "devices"] });
      void qc.invalidateQueries({ queryKey: ["admin", "agent-instances"] });
      void qc.invalidateQueries({ queryKey: ["admin", "presence"] });
      void qc.invalidateQueries({ queryKey: ["admin", "audit"] });
    }
  });
}

export function useDisableAgentInstance(): UseMutationResult<{ ok: boolean; agent_instance_id: string; status: string }, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (instanceId: string) => adminFetch<{ ok: boolean; agent_instance_id: string; status: string }>(
      `/v1/admin/agent-instances/${encodeURIComponent(instanceId)}/disable`,
      { method: "POST", body: {} }
    ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "agent-instances"] });
      void qc.invalidateQueries({ queryKey: ["admin", "presence"] });
      void qc.invalidateQueries({ queryKey: ["admin", "audit"] });
    }
  });
}

export function useAdminInfo(): UseQueryResult<AdminInfo> {
  return useQuery({
    queryKey: ["admin", "info"],
    queryFn: fetchAdminInfo,
    refetchInterval: 15_000
  });
}

export function useAdminOrgSnapshot(orgId: string | null): UseQueryResult<AdminOrgSnapshot> {
  return useQuery({
    queryKey: ["admin", "org-snapshot", orgId],
    queryFn: () => fetchOrgSnapshot(orgId ?? ""),
    enabled: typeof orgId === "string" && orgId.length > 0,
    staleTime: 30_000
  });
}
