import type { QueryClient } from "@tanstack/react-query";

export interface RealtimeTransport {
  kind: "polling" | "sse" | "websocket";
  start(queryClient: QueryClient): void;
  stop(): void;
}

export class PollingTransport implements RealtimeTransport {
  kind = "polling" as const;
  private timers: number[] = [];

  constructor(private intervals: Array<{ queryKey: unknown[]; intervalMs: number }>) {}

  start(queryClient: QueryClient): void {
    this.stop();
    this.timers = this.intervals.map((item) => window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: item.queryKey });
    }, item.intervalMs));
  }

  stop(): void {
    for (const timer of this.timers) window.clearInterval(timer);
    this.timers = [];
  }
}

export class SseTransport implements RealtimeTransport {
  kind = "sse" as const;
  start(): void {
    throw new Error("SSE transport is reserved for a future server push implementation.");
  }
  stop(): void {}
}

export class WebSocketTransport implements RealtimeTransport {
  kind = "websocket" as const;
  start(): void {
    throw new Error("WebSocket transport is reserved for a future server push implementation.");
  }
  stop(): void {}
}
