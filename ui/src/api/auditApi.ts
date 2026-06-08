import type { AuditEvent } from "./types";
import { localAgentClient } from "./localAgentClient";

export const auditApi = {
  events: () => localAgentClient.get<{ events: AuditEvent[]; chainValid?: { valid: boolean } }>("/audit/events")
};
