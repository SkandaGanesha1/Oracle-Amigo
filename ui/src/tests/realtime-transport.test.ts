import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SseTransport } from "../realtime/RealtimeTransport";
import { shouldRefetchActiveConversationRealtime } from "../hooks/useActiveConversationLiveSync";

class MockEventSource {
  static instances: MockEventSource[] = [];

  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly listeners = new Map<string, (event: MessageEvent<string>) => void>();

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(eventName: string, listener: EventListener): void {
    this.listeners.set(eventName, listener as (event: MessageEvent<string>) => void);
  }

  close(): void {}

  emit(eventName: string, data: unknown): void {
    const event = { data: typeof data === "string" ? data : JSON.stringify(data) } as MessageEvent<string>;
    this.listeners.get(eventName)?.(event);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  MockEventSource.instances = [];
});

describe("SseTransport", () => {
  it("parses JSON chat events and invalidates the exact active conversation message cache", () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", MockEventSource);
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const events: unknown[] = [];
    const transport = new SseTransport("/events");

    transport.start(queryClient, (event) => events.push(event));
    MockEventSource.instances[0]!.emit("message", {
      kind: "message_created",
      payload: {
        conversationId: "relay_user_usr-peer",
        messageId: "msg-peer-1"
      },
      timestamp: "2026-06-17T00:00:00.000Z"
    });
    vi.advanceTimersByTime(1000);

    expect(events).toContainEqual(expect.objectContaining({
      kind: "message_created",
      payload: expect.objectContaining({ conversationId: "relay_user_usr-peer" })
    }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["chat", "conversations"] });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["chat", "conversations", "relay_user_usr-peer", "messages"]
    });
    transport.stop();
    vi.useRealTimers();
  });

  it("invalidates only the conversation list for wildcard chat snapshots", () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", MockEventSource);
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const transport = new SseTransport("/events");

    transport.start(queryClient);
    MockEventSource.instances[0]!.emit("message", {
      kind: "conversation_update",
      operation: "snapshot",
      payload: { conversationId: "*" },
      timestamp: "2026-06-17T00:00:00.000Z"
    });
    vi.advanceTimersByTime(1000);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["chat", "conversations"] });
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: ["chat", "conversations", "relay_user_usr-peer", "messages"]
    });
    expect(invalidate.mock.calls.some((call) => typeof call[0]?.predicate === "function")).toBe(false);
    transport.stop();
    vi.useRealTimers();
  });

  it("falls back to invalidating only the conversation list when chat events omit conversation ids", () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", MockEventSource);
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const transport = new SseTransport("/events");

    transport.start(queryClient);
    MockEventSource.instances[0].emit("message", {
      kind: "conversation_update",
      payload: {},
      timestamp: "2026-06-17T00:00:00.000Z"
    });
    vi.advanceTimersByTime(1000);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["chat", "conversations"] });
    expect(invalidate.mock.calls.some((call) => typeof call[0]?.predicate === "function")).toBe(false);
    transport.stop();
    vi.useRealTimers();
  });

  it("cancels pending invalidations on stop", () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", MockEventSource);
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const transport = new SseTransport("/events");

    transport.start(queryClient);
    MockEventSource.instances[0]!.emit("message", {
      kind: "message_created",
      payload: { conversationId: "relay_user_usr-peer" },
      timestamp: "2026-06-17T00:00:00.000Z"
    });
    transport.stop();
    vi.advanceTimersByTime(1000);

    expect(invalidate).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("skips realtime invalidation when the query is already fetching", () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", MockEventSource);
    const queryClient = new QueryClient();
    vi.spyOn(queryClient, "isFetching").mockReturnValue(1);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const transport = new SseTransport("/events");

    transport.start(queryClient);
    MockEventSource.instances[0]!.emit("message", {
      kind: "message_created",
      payload: { conversationId: "relay_user_usr-peer" },
      timestamp: "2026-06-17T00:00:00.000Z"
    });
    vi.advanceTimersByTime(1000);

    expect(invalidate).not.toHaveBeenCalled();
    transport.stop();
    vi.useRealTimers();
  });

  it("falls back to polling configured active message queries after SSE errors", () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", MockEventSource);
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const transport = new SseTransport("/events", [
      { queryKey: ["chat", "conversations", "relay_user_usr-peer", "messages"], intervalMs: 3000 }
    ]);

    transport.start(queryClient);
    MockEventSource.instances[0].onerror?.();
    vi.advanceTimersByTime(3000);

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["chat", "conversations", "relay_user_usr-peer", "messages"]
    });
    transport.stop();
    vi.useRealTimers();
  });

  it("identifies exact and wildcard active-conversation realtime events", () => {
    expect(shouldRefetchActiveConversationRealtime("relay_user_usr-peer", {
      kind: "message_created",
      payload: { conversationId: "relay_user_usr-peer" }
    })).toBe(true);
    expect(shouldRefetchActiveConversationRealtime("relay_user_usr-peer", {
      kind: "conversation_update",
      payload: { conversationId: "*" }
    })).toBe(false);
    expect(shouldRefetchActiveConversationRealtime("relay_user_usr-peer", {
      kind: "message_created",
      payload: { conversationId: "relay_user_other" }
    })).toBe(false);
  });
});
