import type { SandboxEvent } from "./SandboxEvents.js";

export type NetworkProfile = "none" | "npm" | "python" | "github" | "web-basic" | "custom";

export type CommandStatus = "succeeded" | "failed" | "blocked" | "timed_out";

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  matchedRule?: string;
  classification?: string;
}

export interface CreateSandboxSessionInput {
  purpose: string;
  networkProfile: NetworkProfile;
  allowedHosts?: string[];
  ttlSeconds?: number;
}

export interface SandboxSession {
  id: string;
  purpose: string;
  networkProfile: NetworkProfile;
  allowedHosts: string[];
  createdAt: string;
  expiresAt: string;
  closedAt?: string;
}

export interface SandboxRuntime {
  exec(command: string, options?: { timeoutMs?: number; workingDirectory?: string }): Promise<RawExecResult>;
  close(): Promise<void>;
}

export interface RawExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export interface CommandResult {
  sessionId: string;
  commandId: string;
  status: CommandStatus;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  policyDecision: PolicyDecision;
}

export interface CloneAndTestResult {
  clone: CommandResult;
  test?: CommandResult;
}

export interface SessionRecord {
  session: SandboxSession;
  sandbox: SandboxRuntime;
  events: SandboxEvent[];
  cleanupTimer: NodeJS.Timeout;
}
