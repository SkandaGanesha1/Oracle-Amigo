import type { RegistryAgent, RegistryTrustLevel } from "./types";
import { localAgentClient } from "./localAgentClient";

export const registryApi = {
  agents: (trustLevel?: RegistryTrustLevel) => {
    const query = trustLevel ? `?trustLevel=${encodeURIComponent(trustLevel)}` : "";
    return localAgentClient.get<{ count: number; agents: RegistryAgent[] }>(`/registry${query}`);
  },
  trust: (did: string, trustLevel: RegistryTrustLevel) =>
    localAgentClient.put<RegistryAgent>(`/registry/${encodeURIComponent(did)}/trust`, { trustLevel }),
  discover: (body: { url: string; trustLevel?: RegistryTrustLevel }) =>
    localAgentClient.post<{ ok: boolean; did: string; cardHash: string; card?: unknown }>("/registry/discover", body),
};
