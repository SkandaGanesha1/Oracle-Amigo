import type { FileCandidateApprovalCard } from "./types";
import { localAgentClient } from "./localAgentClient";

export const approvalsApi = {
  pending: () => localAgentClient.get<{ approvals: Array<Record<string, unknown>> }>("/approvals/pending"),
  approve: (approvalId: string) => localAgentClient.post(`/approvals/${encodeURIComponent(approvalId)}/approve`, {}),
  reject: (approvalId: string) => localAgentClient.post(`/approvals/${encodeURIComponent(approvalId)}/reject`, {}),
  feedback: (approvalId: string, feedback: string) =>
    localAgentClient.post(`/approvals/${encodeURIComponent(approvalId)}/feedback`, { feedback }),
  rebindFile: (approvalId: string, fileId: string) =>
    localAgentClient.post<FileCandidateApprovalCard>(`/approvals/${encodeURIComponent(approvalId)}/rebind-file`, { fileId })
};
