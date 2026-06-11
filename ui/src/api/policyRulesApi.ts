import { localAgentClient } from "./localAgentClient";
import type { PolicyEvaluation, PolicyRule } from "./types";

export type PolicyRuleInput = Omit<Partial<PolicyRule>, "createdAt" | "updatedAt"> & {
  name: string;
  action: PolicyRule["action"];
};

export const policyRulesApi = {
  list: () => localAgentClient.get<{ rules: PolicyRule[] }>("/policy/rules"),
  create: (body: PolicyRuleInput) => localAgentClient.post<{ rule: PolicyRule }>("/policy/rules", body),
  update: (id: string, body: PolicyRuleInput) => localAgentClient.put<{ rule: PolicyRule }>(`/policy/rules/${encodeURIComponent(id)}`, body),
  remove: (id: string) => localAgentClient.delete<{ ok: boolean }>(`/policy/rules/${encodeURIComponent(id)}`),
  evaluate: (body: {
    role?: string;
    sensitivity?: string;
    fileExtension?: string;
    mimeType?: string;
    transferDirection?: string;
    fileSizeBytes?: number;
  }) => localAgentClient.post<{ evaluation: PolicyEvaluation }>("/policy/evaluate", body),
  exportUrl: () => "/policy/export.csv"
};
