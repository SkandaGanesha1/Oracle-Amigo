import { userInfo } from "node:os";
import { resolveLocalAgentId, resolveLocalTenantId } from "./connection.js";

export interface TenantProfile {
  tenantId: string;
  agentId: string;
  osUsername: string;
  hostname: string;
  storageRoot: string;
  isolated: boolean;
}

let activeProfile: TenantProfile | null = null;

export function getActiveProfile(): TenantProfile {
  if (activeProfile) return activeProfile;
  const tenantId = resolveLocalTenantId();
  const agentId = resolveLocalAgentId();
  let osUsername = "unknown";
  try {
    osUsername = userInfo().username;
  } catch { /* unknown */ }
  const hostname = process.env.ANP_HOSTNAME ?? "127.0.0.1";
  const storageRoot = process.env.AGENTIC_STORAGE_ROOT ?? "./storage";
  activeProfile = {
    tenantId,
    agentId,
    osUsername,
    hostname,
    storageRoot,
    isolated: true,
  };
  return activeProfile;
}

export function setActiveProfile(profile: Partial<TenantProfile>): TenantProfile {
  const current = getActiveProfile();
  activeProfile = { ...current, ...profile };
  if (activeProfile.tenantId) process.env.AGENTIC_TENANT_ID = activeProfile.tenantId;
  if (activeProfile.agentId) process.env.AGENTIC_AGENT_ID = activeProfile.agentId;
  return activeProfile;
}

export function resetActiveProfile(): void {
  activeProfile = null;
  delete process.env.AGENTIC_TENANT_ID;
  delete process.env.AGENTIC_AGENT_ID;
}

export function isSameOsUser(other: { osUsername: string }): boolean {
  return getActiveProfile().osUsername === other.osUsername;
}

export function getProfileScopedPath(basePath: string): string {
  const profile = getActiveProfile();
  return `${basePath}/${profile.tenantId}/${profile.agentId}`;
}
