import { localAgentClient } from "./localAgentClient";
import type { NotificationEvent } from "./types";

export const notificationsApi = {
  list: (limit = 50) =>
    localAgentClient.get<{ events: NotificationEvent[] }>(`/notifications?limit=${encodeURIComponent(String(limit))}`),
  create: (body: {
    eventType: string;
    title: string;
    body: string;
    severity?: NotificationEvent["severity"];
    entityType?: string | null;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  }) => localAgentClient.post<{ event: NotificationEvent }>("/notifications", body)
};
