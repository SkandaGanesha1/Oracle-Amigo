import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { adminFetch } from "./client";
import type {
  AdminAgentInstance,
  AdminAuditEvent,
  AdminDevice,
  AdminInfo,
  AdminOrgSnapshot,
  AdminPresence,
  AdminTask,
  AdminTransfer,
  AdminUser
} from "./types";

export type {
  AdminAgentInstance,
  AdminAuditEvent,
  AdminDevice,
  AdminInfo,
  AdminOrgSnapshot,
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
