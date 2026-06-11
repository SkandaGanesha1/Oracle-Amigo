import type { AuditEvent, AuditVerifyResult } from "./types";
import { localAgentClient } from "./localAgentClient";

export const auditApi = {
  events: () => localAgentClient.get<{ events: AuditEvent[]; chainValid?: { valid: boolean } }>("/audit/events"),
  verify: () => localAgentClient.get<AuditVerifyResult>("/audit/verify")
};
