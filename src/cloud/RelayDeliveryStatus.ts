import type { DeliveryStatus } from "../chat/ChatRepository.js";

export function normalizeRelayDeliveryStatus(relayStatus: string, responseStatus: string | null): DeliveryStatus {
  if (responseStatus && isDeliveryStatus(responseStatus)) return responseStatus;
  if (relayStatus === "accepted" || relayStatus === "queued") return "queued_at_relay";
  if (relayStatus === "delivered_to_remote_agent") return "delivered_to_remote_agent";
  if (
    relayStatus === "stored_by_remote_agent" ||
    relayStatus === "waiting_approval" ||
    relayStatus === "approved" ||
    relayStatus === "transfer_started" ||
    relayStatus === "completed"
  ) return "stored_by_remote_agent";
  if (relayStatus === "failed" || relayStatus === "expired") return "failed";

  if (relayStatus === "pending") return "queued_at_relay";
  if (relayStatus === "delivered") return "delivered_to_remote_agent";
  if (relayStatus === "cancelled") return "failed";
  return "queued_at_relay";
}

function isDeliveryStatus(value: string): value is DeliveryStatus {
  return [
    "local_pending",
    "queued_at_relay",
    "delivered_to_remote_agent",
    "stored_by_remote_agent",
    "read_by_remote_user",
    "sent",
    "delivered",
    "failed"
  ].includes(value);
}
