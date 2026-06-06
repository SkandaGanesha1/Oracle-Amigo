import { EventEmitter } from "node:events";

export type SandboxEventType =
  | "session.created"
  | "session.closed"
  | "command.started"
  | "command.policy_checked"
  | "command.blocked"
  | "command.succeeded"
  | "command.failed"
  | "command.timed_out"
  | "secret.redacted"
  | "network.denied";

export interface SandboxEvent {
  timestamp: string;
  type: SandboxEventType;
  message: string;
  metadata: Record<string, unknown>;
}

export class SandboxEventBus extends EventEmitter {
  emitEvent(event: Omit<SandboxEvent, "timestamp">): SandboxEvent {
    const fullEvent: SandboxEvent = {
      timestamp: new Date().toISOString(),
      ...event
    };

    this.emit(fullEvent.type, fullEvent);
    this.emit("event", fullEvent);
    return fullEvent;
  }
}
