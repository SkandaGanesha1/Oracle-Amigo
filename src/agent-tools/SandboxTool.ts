import {
  randomUUID
} from "node:crypto";
import {
  CloneRepoAndRunTestsSchema,
  CloseSandboxSessionSchema,
  CreateSandboxSessionSchema,
  RunCodeSchema,
  RunShellCommandSchema,
  type CloneRepoAndRunTestsRequest,
  type CloseSandboxSessionRequest,
  type CreateSandboxSessionRequest,
  type RunCodeRequest,
  type RunShellCommandRequest
} from "./ToolSchemas.js";
import type { CloneAndTestResult, CommandResult, SandboxSession } from "../sandbox/SandboxTypes.js";
import { SandboxSessionManager } from "../sandbox/SandboxSessionManager.js";

export class SandboxTool {
  constructor(readonly sessions = new SandboxSessionManager()) {}

  async createSandboxSession(input: CreateSandboxSessionRequest): Promise<{
    sessionId: string;
    status: "created";
    networkProfile: string;
    allowedHosts: string[];
    createdAt: string;
  }> {
    const parsed = CreateSandboxSessionSchema.parse(input);
    const session = await this.sessions.createSession(parsed);
    return {
      sessionId: session.id,
      status: "created",
      networkProfile: session.networkProfile,
      allowedHosts: session.allowedHosts,
      createdAt: session.createdAt
    };
  }

  listSandboxSessions(): SandboxSession[] {
    return this.sessions.listSessions();
  }

  async runShellCommand(input: RunShellCommandRequest): Promise<CommandResult> {
    const parsed = RunShellCommandSchema.parse(input);
    return this.sessions.runCommand(parsed.sessionId, parsed.command, {
      timeoutMs: parsed.timeoutMs,
      workingDirectory: parsed.workingDirectory
    });
  }

  async runPythonCode(input: RunCodeRequest): Promise<CommandResult> {
    const parsed = RunCodeSchema.parse(input);
    const encoded = Buffer.from(parsed.code, "utf8").toString("base64");
    const scriptPath = `/tmp/agent_task_${randomUUID()}.py`;
    const command = `printf %s ${shellQuote(encoded)} | base64 -d > ${shellQuote(scriptPath)} && python3 ${shellQuote(scriptPath)}`;
    return this.sessions.runCommand(parsed.sessionId, command, { timeoutMs: parsed.timeoutMs });
  }

  async runNodeCode(input: RunCodeRequest): Promise<CommandResult> {
    const parsed = RunCodeSchema.parse(input);
    const encoded = Buffer.from(parsed.code, "utf8").toString("base64");
    const scriptPath = `/tmp/agent_task_${randomUUID()}.mjs`;
    const command = `printf %s ${shellQuote(encoded)} | base64 -d > ${shellQuote(scriptPath)} && node ${shellQuote(scriptPath)}`;
    return this.sessions.runCommand(parsed.sessionId, command, { timeoutMs: parsed.timeoutMs });
  }

  async cloneRepoAndRunTests(input: CloneRepoAndRunTestsRequest): Promise<CloneAndTestResult> {
    const parsed = CloneRepoAndRunTestsSchema.parse(input);
    const repoPath = `/workspace/repo_${randomUUID()}`;
    const clone = await this.sessions.runCommand(
      parsed.sessionId,
      `mkdir -p /workspace && git clone ${shellQuote(parsed.repoUrl)} ${shellQuote(repoPath)}`,
      { timeoutMs: parsed.timeoutMs }
    );

    if (clone.status !== "succeeded") {
      return { clone };
    }

    const test = await this.sessions.runCommand(parsed.sessionId, parsed.testCommand, {
      timeoutMs: parsed.timeoutMs,
      workingDirectory: repoPath
    });
    return { clone, test };
  }

  async closeSandboxSession(input: CloseSandboxSessionRequest): Promise<{ sessionId: string; status: "closed" }> {
    const parsed = CloseSandboxSessionSchema.parse(input);
    return this.sessions.closeSession(parsed.sessionId);
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
