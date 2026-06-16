import type { QueryClient } from "@tanstack/react-query";

export type RealtimeEventKind =
  | "mission_update"
  | "approval_update"
  | "transfer_update"
  | "conversation_update"
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

function parseRealtimeEvent(data: string): RealtimeEvent | null {
  try {
    const parsed = JSON.parse(data);
    return {
      kind: parsed.kind ?? parsed.type ?? "unknown",
      payload: parsed.payload ?? parsed.data ?? {},
      timestamp: parsed.timestamp ?? new Date().toISOString(),
    };
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
  if (kind === "conversation_update") return ["chat", "conversations"];
  if (kind === "voice_command_update") return ["voice", "commands"];
  if (kind === "cloud_status") return ["cloud-status"];
  return ["missions"];
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
        const handleEvent = (event: MessageEvent<string>) => {
          const data = parseSseData(event.data);
          const parsed = typeof data === "string" ? parseRealtimeEvent(data) : null;
          if (parsed) {
            onEvent?.(parsed);
            void queryClient.invalidateQueries({ queryKey: queryKeyFromKind(parsed.kind) });
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
  }

  private startFallbackPolling(queryClient: QueryClient): void {
    if (this.fallbackTimers.length > 0) return;
    this.fallbackTimers = this.fallbackPoll.map((item) => window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: item.queryKey });
    }, item.intervalMs));
  }
}

export class WebSocketTransport implements RealtimeTransport {
  kind = "websocket" as const;
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private fallbackTimers: number[] = [];
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
      };
      this.ws.onmessage = (event) => {
        const parsed = parseRealtimeEvent(String(event.data));
        if (parsed) {
          onEvent?.(parsed);
          void queryClient.invalidateQueries({ queryKey: queryKeyFromKind(parsed.kind) });
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
      void queryClient.invalidateQueries({ queryKey: item.queryKey });
    }, item.intervalMs));
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
