import type { PolicyCommandEvaluation, PolicySummary } from "./types";
import { localAgentClient } from "./localAgentClient";

export const policyApi = {
  summary: () => localAgentClient.get<PolicySummary>("/policy/summary"),
  evaluateCommand: (body: { command: string; timeoutMs?: number }) =>
    localAgentClient.post<PolicyCommandEvaluation>("/policy/command/evaluate", body),
};
