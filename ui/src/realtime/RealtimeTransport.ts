import type { QueryClient } from "@tanstack/react-query";

export type RealtimeEventKind =
  | "mission_update"
  | "approval_update"
  | "transfer_update"
  | "conversation_update"
  | "message_created"
  | "voice_command_update"
  | "agent_status"
  | "cloud_status"
  | "unknown";

export interface RealtimeEvent {
  kind: RealtimeEventKind;
  payload: Record<string, unknown>;
  timestamp: string;
}

export type TransportKind = "websocket" | "sse" | "polling";

export interface PollingItem {
  queryKey: unknown[];
  intervalMs: number;
}

export interface RealtimeTransport {
  kind: TransportKind;
  start(queryClient: QueryClient, onEvent?: (event: RealtimeEvent) => void): void;
  stop(): void;
}

export interface SseSubscription {
  url: string;
  eventName: string;
  queryKey?: unknown[];
  hydrate?: (data: unknown, queryClient: QueryClient) => void;
  invalidate?: unknown[][];
  closeWhen?: (data: unknown) => boolean;
}

const DEFAULT_INVALIDATION_DEBOUNCE_MS = 1000;

type PendingInvalidation = {
  timer: number;
  action: () => void;
};

class RealtimeInvalidationCoalescer {
  private pending = new Map<string, PendingInvalidation>();

  invalidate(key: string, action: () => void, debounceMs = DEFAULT_INVALIDATION_DEBOUNCE_MS): void {
    const existing = this.pending.get(key);
    if (existing) {
      existing.action = action;
      return;
    }
    const pending: PendingInvalidation = {
      action,
      timer: window.setTimeout(() => {
        this.pending.delete(key);
        pending.action();
      }, debounceMs)
    };
    this.pending.set(key, pending);
  }

  cancel(): void {
    for (const [key, pending] of this.pending) {
      window.clearTimeout(pending.timer);
      this.pending.delete(key);
    }
  }
}

function invalidateQueryWhenIdle(queryClient: QueryClient, queryKey: unknown[]): void {
  if (queryClient.isFetching({ queryKey }) > 0) return;
  void queryClient.invalidateQueries({ queryKey });
}

function normalizeRealtimeEvent(parsed: unknown): RealtimeEvent | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const payload = record.payload ?? record.data ?? {};
  return {
    kind: typeof record.kind === "string"
      ? record.kind as RealtimeEventKind
      : typeof record.type === "string"
        ? record.type as RealtimeEventKind
        : "unknown",
    payload: payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {},
    timestamp: typeof record.timestamp === "string" ? record.timestamp : new Date().toISOString(),
  };
}

function parseRealtimeEvent(data: string): RealtimeEvent | null {
  try {
    return normalizeRealtimeEvent(JSON.parse(data));
  } catch {
    return null;
  }
}

function parseSseData(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

function queryKeyFromKind(kind: string): unknown[] {
  if (kind === "mission_update") return ["missions"];
  if (kind === "approval_update") return ["approvals", "pending"];
  if (kind === "transfer_update") return ["files", "received"];
  if (kind === "conversation_update" || kind === "message_created") return ["chat", "conversations"];
  if (kind === "voice_command_update") return ["voice", "commands"];
  if (kind === "agent_status") return ["agent", "profiles"];
  if (kind === "cloud_status") return ["cloud-status"];
  return ["missions"];
}

function invalidateRealtimeEvent(
  queryClient: QueryClient,
  event: RealtimeEvent,
  coalescer: RealtimeInvalidationCoalescer
): void {
  const baseKey = queryKeyFromKind(event.kind);
  coalescer.invalidate(`base:${JSON.stringify(baseKey)}`, () => {
    invalidateQueryWhenIdle(queryClient, baseKey);
  });
  if (event.kind === "agent_status" || event.kind === "cloud_status") {
    coalescer.invalidate("agent:profiles", () => {
      invalidateQueryWhenIdle(queryClient, ["agent", "profiles"]);
    });
    coalescer.invalidate("trust:graph", () => {
      invalidateQueryWhenIdle(queryClient, ["trust", "graph"]);
    });
  }
  if (event.kind !== "conversation_update" && event.kind !== "message_created") return;

  const conversationId = event.payload.conversationId;
  if (typeof conversationId === "string" && conversationId && conversationId !== "*") {
    coalescer.invalidate(`chat:messages:${conversationId}`, () => {
      invalidateQueryWhenIdle(queryClient, ["chat", "conversations", conversationId, "messages"]);
    });
    return;
  }

  if (conversationId === "*" || !conversationId) {
    if (!conversationId && import.meta.env.DEV) {
      console.warn("Realtime chat event missing payload.conversationId; invalidating all chat conversation queries.");
    }
  }
}

function sameOriginSseUrl(raw: string, baseUrl: string): string {
  const value = raw.trim();
  const base = baseUrl.trim();
  const combined =
    value.startsWith("http")
      ? value
      : base && value.startsWith("/")
        ? `${base}${value}`
        : value;
  const parsed = new URL(combined, window.location.origin);
  if (parsed.origin !== window.location.origin) {
    throw new Error("Cross-origin SSE endpoints are not allowed");
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export class PollingTransport implements RealtimeTransport {
  kind = "polling" as const;
  private timers: number[] = [];

  constructor(private intervals: PollingItem[]) {}

  start(queryClient: QueryClient, _onEvent?: (event: RealtimeEvent) => void): void {
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
  private eventSources: EventSource[] = [];
  private fallbackTimers: number[] = [];
  private invalidations = new RealtimeInvalidationCoalescer();
  private subscriptions: SseSubscription[];

  constructor(
    urlOrSubscriptions: string | SseSubscription[],
    private fallbackPoll: PollingItem[] = []
  ) {
    this.subscriptions = typeof urlOrSubscriptions === "string"
      ? [{ url: urlOrSubscriptions, eventName: "message" }]
      : urlOrSubscriptions;
  }

  start(queryClient: QueryClient, onEvent?: (event: RealtimeEvent) => void): void {
    this.stop();
    try {
      const baseUrl = (window as unknown as Record<string, string>).__API_BASE_URL__ ?? "";
      this.eventSources = this.subscriptions.map((subscription) => {
        const url = sameOriginSseUrl(subscription.url, baseUrl);
        const eventSource = new EventSource(url);
        eventSource.onopen = () => {
          this.stopFallbackPolling();
        };
        const handleEvent = (event: MessageEvent<string>) => {
          const data = parseSseData(event.data);
          const parsed = typeof data === "string" ? parseRealtimeEvent(data) : normalizeRealtimeEvent(data);
          if (parsed) {
            onEvent?.(parsed);
            invalidateRealtimeEvent(queryClient, parsed, this.invalidations);
          }
          if (subscription.queryKey) queryClient.setQueryData(subscription.queryKey, data);
          subscription.hydrate?.(data, queryClient);
          for (const queryKey of subscription.invalidate ?? []) {
            void queryClient.invalidateQueries({ queryKey });
          }
          if (subscription.closeWhen?.(data)) eventSource.close();
        };
        eventSource.addEventListener(subscription.eventName, handleEvent as EventListener);
        if (subscription.eventName === "message") eventSource.onmessage = handleEvent;
        eventSource.onerror = () => {
          eventSource.close();
          this.startFallbackPolling(queryClient);
        };
        return eventSource;
      });
    } catch {
      this.startFallbackPolling(queryClient);
    }
  }

  stop(): void {
    for (const eventSource of this.eventSources) eventSource.close();
    this.eventSources = [];
    for (const timer of this.fallbackTimers) window.clearInterval(timer);
    this.fallbackTimers = [];
    this.invalidations.cancel();
  }

  private startFallbackPolling(queryClient: QueryClient): void {
    if (this.fallbackTimers.length > 0) return;
    this.fallbackTimers = this.fallbackPoll.map((item) => window.setInterval(() => {
      invalidateQueryWhenIdle(queryClient, item.queryKey);
    }, item.intervalMs));
  }

  private stopFallbackPolling(): void {
    for (const timer of this.fallbackTimers) window.clearInterval(timer);
    this.fallbackTimers = [];
  }
}

export class WebSocketTransport implements RealtimeTransport {
  kind = "websocket" as const;
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private fallbackTimers: number[] = [];
  private invalidations = new RealtimeInvalidationCoalescer();
  private stopped = false;

  constructor(
    private url: string,
    private reconnectMs = 3000,
    private fallbackPoll: PollingItem[] = []
  ) {}

  start(queryClient: QueryClient, onEvent?: (event: RealtimeEvent) => void): void {
    this.stopped = false;
    this.connect(queryClient, onEvent);
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    for (const timer of this.fallbackTimers) window.clearInterval(timer);
    this.fallbackTimers = [];
    this.invalidations.cancel();
  }

  private connect(queryClient: QueryClient, onEvent?: (event: RealtimeEvent) => void): void {
    if (this.stopped) return;
    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => {
        if (this.reconnectTimer) {
          window.clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.stopFallbackPolling();
      };
      this.ws.onmessage = (event) => {
        const parsed = parseRealtimeEvent(String(event.data));
        if (parsed) {
          onEvent?.(parsed);
          invalidateRealtimeEvent(queryClient, parsed, this.invalidations);
        }
      };
      this.ws.onclose = () => {
        if (this.stopped) return;
        this.reconnectTimer = window.setTimeout(() => this.connect(queryClient, onEvent), this.reconnectMs);
        this.startFallbackPolling(queryClient);
      };
      this.ws.onerror = () => this.ws?.close();
    } catch {
      this.startFallbackPolling(queryClient);
    }
  }

  private startFallbackPolling(queryClient: QueryClient): void {
    if (this.fallbackTimers.length > 0) return;
    this.fallbackTimers = this.fallbackPoll.map((item) => window.setInterval(() => {
      invalidateQueryWhenIdle(queryClient, item.queryKey);
    }, item.intervalMs));
  }

  private stopFallbackPolling(): void {
    for (const timer of this.fallbackTimers) window.clearInterval(timer);
    this.fallbackTimers = [];
  }
}

export class RealtimeLifecycle implements RealtimeTransport {
  kind: TransportKind = "polling";
  private transport: RealtimeTransport | null = null;

  constructor(private items: PollingItem[]) {}

  start(queryClient: QueryClient): void {
    const sseUrl = this.detectSseUrl();
    if (sseUrl) {
      this.transport = new SseTransport(sseUrl, this.items);
      this.kind = "sse";
    } else {
      this.transport = new PollingTransport(this.items);
      this.kind = "polling";
    }
    this.transport.start(queryClient);
  }

  stop(): void {
    this.transport?.stop();
    this.transport = null;
  }

  private detectSseUrl(): string | null {
    try {
      const storedUrl = localStorage.getItem("oa-realtime-sse-url");
      if (!storedUrl) return null;

      const resolvedUrl = new URL(storedUrl, window.location.origin);
      if (resolvedUrl.origin !== window.location.origin) return null;

      return `${resolvedUrl.pathname}${resolvedUrl.search}${resolvedUrl.hash}`;
    } catch {
      return null;
    }
  }
}
