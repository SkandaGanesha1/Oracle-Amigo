import { localAgentClient } from "./localAgentClient";
import type { PolicyEvaluation, RedactionJob, RedactionMark, RedactionPreview } from "./types";

export interface RedactionRequest {
  fileId: string;
  recipientLabel: string;
  watermarkText?: string;
  redactions?: RedactionMark[];
}

export const redactionsApi = {
  preview: (body: RedactionRequest) =>
    localAgentClient.post<RedactionPreview>("/redactions/preview", body),
  apply: (body: RedactionRequest) =>
    localAgentClient.post<{ job: RedactionJob; policy: PolicyEvaluation }>("/redactions/apply", body),
  downloadUrl: (redactionId: string) => `/redactions/${encodeURIComponent(redactionId)}/download`
};
