import { randomUUID } from "node:crypto";
import { CommandPolicy } from "../policy/CommandPolicy.js";
import { NetworkPolicy } from "../policy/NetworkPolicy.js";
import { SecretPolicy } from "../policy/SecretPolicy.js";
import { GondolinSandbox } from "./GondolinSandbox.js";
import { SandboxEventBus, type SandboxEvent } from "./SandboxEvents.js";
import type {
  CommandResult,
  CreateSandboxSessionInput,
  PolicyDecision,
  SandboxSession,
  SessionRecord
} from "./SandboxTypes.js";

export interface SandboxSessionManagerOptions {
  commandPolicy?: CommandPolicy;
  networkPolicy?: NetworkPolicy;
  secretPolicy?: SecretPolicy;
  eventBus?: SandboxEventBus;
}

export class SandboxSessionManager {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly sessionLocks = new Map<string, Promise<unknown>>();
  private readonly commandPolicy: CommandPolicy;
  private readonly networkPolicy: NetworkPolicy;
  private readonly secretPolicy: SecretPolicy;
  readonly eventBus: SandboxEventBus;

  constructor(options: SandboxSessionManagerOptions = {}) {
    this.commandPolicy = options.commandPolicy ?? new CommandPolicy();
    this.networkPolicy = options.networkPolicy ?? new NetworkPolicy();
    this.secretPolicy = options.secretPolicy ?? new SecretPolicy();
    this.eventBus = options.eventBus ?? new SandboxEventBus();
  }

  async createSession(input: CreateSandboxSessionInput): Promise<SandboxSession> {
    const network = this.networkPolicy.resolve(input.networkProfile, input.allowedHosts);
    const ttlSeconds = input.ttlSeconds ?? Number(process.env.SANDBOX_DEFAULT_TTL_SECONDS ?? 1800);
    const createdAt = new Date();
    const session: SandboxSession = {
      id: randomUUID(),
      purpose: input.purpose,
      networkProfile: input.networkProfile,
      allowedHosts: network.allowedHosts,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + ttlSeconds * 1000).toISOString()
    };

    const sandbox = await GondolinSandbox.create({
      network,
      secretPolicy: this.secretPolicy,
      onNetworkDenied: (event) => this.recordEvent(session.id, event)
    });

    const cleanupTimer = setTimeout(() => {
      void this.closeSession(session.id);
    }, ttlSeconds * 1000);
    cleanupTimer.unref();

    this.sessions.set(session.id, {
      session,
      sandbox,
      events: [],
      cleanupTimer
    });

    this.recordEvent(session.id, {
      type: "session.created",
      message: `Session created for ${input.purpose}`,
      metadata: { sessionId: session.id, networkProfile: session.networkProfile, allowedHosts: session.allowedHosts }
    });

    return session;
  }

  listSessions(): SandboxSession[] {
    return [...this.sessions.values()].map((record) => record.session);
  }

  getEvents(sessionId: string): SandboxEvent[] {
    return [...this.getRecord(sessionId).events];
  }

  async runCommand(sessionId: string, command: string, options: { timeoutMs?: number; workingDirectory?: string } = {}): Promise<CommandResult> {
    return this.withSessionLock(sessionId, async () => this.runCommandUnlocked(sessionId, command, options));
  }

  private async runCommandUnlocked(sessionId: string, command: string, options: { timeoutMs?: number; workingDirectory?: string } = {}): Promise<CommandResult> {
    const record = this.getRecord(sessionId);
    const commandId = randomUUID();
    const timeoutMs = this.commandPolicy.capTimeout(options.timeoutMs);
    const started = Date.now();

    this.recordEvent(sessionId, {
      type: "command.started",
      message: "Command started",
      metadata: { sessionId, commandId, command: this.secretPolicy.redactText(command), timeoutMs }
    });

    const policyDecision = this.commandPolicy.evaluate(command);
    this.recordPolicyDecision(sessionId, commandId, policyDecision);

    if (!policyDecision.allowed) {
      const result: CommandResult = {
        sessionId,
        commandId,
        status: "blocked",
        exitCode: null,
        stdout: "",
        stderr: policyDecision.reason,
        durationMs: Date.now() - started,
        policyDecision
      };
      this.recordEvent(sessionId, {
        type: "command.blocked",
        message: policyDecision.reason,
        metadata: { sessionId, commandId, matchedRule: policyDecision.matchedRule }
      });
      return result;
    }

    const raw = await record.sandbox.exec(command, { timeoutMs, workingDirectory: options.workingDirectory });
    const durationMs = Date.now() - started;
    const stdout = this.secretPolicy.redactText(raw.stdout);
    const stderr = this.secretPolicy.redactText(raw.stderr);
    const status = raw.timedOut ? "timed_out" : raw.exitCode === 0 ? "succeeded" : "failed";

    if (this.secretPolicy.containsRedaction(raw.stdout) || this.secretPolicy.containsRedaction(raw.stderr)) {
      this.recordEvent(sessionId, {
        type: "secret.redacted",
        message: "Sensitive value redacted from command output",
        metadata: { sessionId, commandId }
      });
    }

    const result: CommandResult = {
      sessionId,
      commandId,
      status,
      exitCode: raw.exitCode,
      stdout,
      stderr,
      durationMs,
      policyDecision
    };

    this.recordEvent(sessionId, {
      type: status === "timed_out" ? "command.timed_out" : status === "succeeded" ? "command.succeeded" : "command.failed",
      message: status === "succeeded" ? "Command succeeded" : status === "timed_out" ? "Command timed out" : "Command failed",
      metadata: { sessionId, commandId, exitCode: raw.exitCode, durationMs }
    });

    return result;
  }

  async closeSession(sessionId: string): Promise<{ sessionId: string; status: "closed" }> {
    return this.withSessionLock(sessionId, async () => this.closeSessionUnlocked(sessionId));
  }

  private async closeSessionUnlocked(sessionId: string): Promise<{ sessionId: string; status: "closed" }> {
    const record = this.getRecord(sessionId);
    clearTimeout(record.cleanupTimer);
    await record.sandbox.close();
    record.session.closedAt = new Date().toISOString();
    this.recordEvent(sessionId, {
      type: "session.closed",
      message: "Session closed",
      metadata: { sessionId }
    });
    this.sessions.delete(sessionId);
    return { sessionId, status: "closed" };
  }

  private async withSessionLock<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.sessionLocks.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = previous.then(() => current, () => current);
    this.sessionLocks.set(sessionId, next);
    try {
      await previous.catch(() => undefined);
      return await operation();
    } finally {
      release();
      if (this.sessionLocks.get(sessionId) === next) {
        this.sessionLocks.delete(sessionId);
      }
    }
  }

  private recordPolicyDecision(sessionId: string, commandId: string, decision: PolicyDecision): void {
    this.recordEvent(sessionId, {
      type: "command.policy_checked",
      message: decision.reason,
      metadata: { sessionId, commandId, decision }
    });
  }

  private recordEvent(sessionId: string, event: Omit<SandboxEvent, "timestamp">): void {
    const fullEvent = this.eventBus.emitEvent(event);
    const record = this.sessions.get(sessionId);
    if (record) {
      record.events.push(fullEvent);
    }
  }

  private getRecord(sessionId: string): SessionRecord {
    const record = this.sessions.get(sessionId);
    if (!record) {
      throw new Error(`Unknown sandbox session: ${sessionId}`);
    }
    return record;
  }
}
