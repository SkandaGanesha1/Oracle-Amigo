import { describe, expect, it } from "vitest";
import { normalizeRelayDeliveryStatus } from "../src/cloud/RelayDeliveryStatus.js";

describe("relay delivery status mapping", () => {
  it("maps control-plane relay task states to local chat delivery states", () => {
    expect(normalizeRelayDeliveryStatus("accepted", null)).toBe("queued_at_relay");
    expect(normalizeRelayDeliveryStatus("queued", null)).toBe("queued_at_relay");
    expect(normalizeRelayDeliveryStatus("delivered_to_remote_agent", null)).toBe("delivered_to_remote_agent");
    expect(normalizeRelayDeliveryStatus("stored_by_remote_agent", null)).toBe("stored_by_remote_agent");
    expect(normalizeRelayDeliveryStatus("waiting_approval", null)).toBe("stored_by_remote_agent");
    expect(normalizeRelayDeliveryStatus("approved", null)).toBe("stored_by_remote_agent");
    expect(normalizeRelayDeliveryStatus("transfer_started", null)).toBe("stored_by_remote_agent");
    expect(normalizeRelayDeliveryStatus("completed", null)).toBe("stored_by_remote_agent");
    expect(normalizeRelayDeliveryStatus("failed", null)).toBe("failed");
    expect(normalizeRelayDeliveryStatus("expired", null)).toBe("failed");
  });

  it("keeps explicit receiver delivery receipts authoritative", () => {
    expect(normalizeRelayDeliveryStatus("completed", "failed")).toBe("failed");
    expect(normalizeRelayDeliveryStatus("queued", "stored_by_remote_agent")).toBe("stored_by_remote_agent");
  });

  it("keeps legacy statuses readable for existing local records", () => {
    expect(normalizeRelayDeliveryStatus("pending", null)).toBe("queued_at_relay");
    expect(normalizeRelayDeliveryStatus("delivered", null)).toBe("delivered_to_remote_agent");
    expect(normalizeRelayDeliveryStatus("cancelled", null)).toBe("failed");
  });
});
