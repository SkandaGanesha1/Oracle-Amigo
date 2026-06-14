import { localAgentClient } from "./localAgentClient";
import type { InboxBucket, InboxItem, InboxItemStatus, InboxItemsResult } from "./types";

export interface InboxItemsParams {
  bucket?: InboxBucket;
  status?: InboxItemStatus;
  q?: string;
  cursor?: string;
  limit?: number;
}

export type InboxServerAction = "read" | "archive" | "snooze" | "approve" | "deny" | "ask_why";

function inboxItemsUrl(params: InboxItemsParams = {}): string {
  const search = new URLSearchParams();
  if (params.bucket) search.set("bucket", params.bucket);
  if (params.status) search.set("status", params.status);
  if (params.q) search.set("q", params.q);
  if (params.cursor) search.set("cursor", params.cursor);
  if (params.limit) search.set("limit", String(params.limit));
  const suffix = search.toString();
  return `/api/inbox/items${suffix ? `?${suffix}` : ""}`;
}

export const inboxApi = {
  items: (params?: InboxItemsParams) => localAgentClient.get<InboxItemsResult>(inboxItemsUrl(params)),
  item: (itemId: string) => localAgentClient.get<{ item: InboxItem }>(`/api/inbox/items/${encodeURIComponent(itemId)}`),
  action: (itemId: string, action: InboxServerAction, body: Record<string, unknown> = {}) => {
    const endpoint = action === "ask_why" ? "ask-why" : action;
    return localAgentClient.post<{ ok: boolean; itemId: string }>(`/api/inbox/items/${encodeURIComponent(itemId)}/${endpoint}`, body);
  },
  bulk: (body: { itemIds: string[]; action: "read" | "archive" | "snooze"; snoozedUntil?: string }) =>
    localAgentClient.post<{ ok: boolean; itemIds: string[]; action: string }>("/api/inbox/bulk", body)
};
