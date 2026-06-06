import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { SandboxTool } from "../agent-tools/SandboxTool.js";
import type { CommandResult } from "../sandbox/SandboxTypes.js";
import { FileSearchService, type FileSearchResult } from "../file-search/FileSearchService.js";
import { HostSearchCommandRunner } from "../host/HostSearchCommandRunner.js";
import {
  type AgentDecision,
  type AgentObservation,
  type AgentReasoner,
  type AgentReasoningContext
} from "./AgentDecision.js";
import { createDefaultReasoner } from "../oci/OciGenAiClient.js";

export type AgentRunExecutionTarget = "agent-orchestrator" | "oci-llm" | "gondolin-vm-command" | "host-file-search";
export type AgentRunStatus = "running" | "completed" | "partial" | "failed";
export type AgentRunStepStatus = "running" | "completed" | "failed" | "skipped";

export type AgentRunStep = {
  id: string;
  label: string;
  executionTarget: AgentRunExecutionTarget;
  status: AgentRunStepStatus;
  command?: string;
  stdout: string;
  stderr?: string;
  durationMs: number;
  sessionId?: string;
};

export type AgentRunResult = {
  runId: string;
  query: string;
  createdAt: string;
  updatedAt: string;
  status: AgentRunStatus;
  reasoningMode: "oci-agent-loop";
  searchedRoots: string[];
  iterations: AgentObservation[];
  sandboxSession: {
    requested: boolean;
    created: boolean;
    sessionId: string | null;
    networkProfile: string | null;
    error?: string;
  };
  steps: AgentRunStep[];
  fileSearch: FileSearchResult | null;
  finalAnswer: {
    status: "found" | "not_found" | "need_help";
    message: string;
    selectedFileId?: string;
  } | null;
};

export type CreateAgentRunInput = {
  query: string;
  createSandboxSession?: boolean;
};

export class AgentRunService {
  private readonly runs = new Map<string, AgentRunResult>();
  private readonly events = new EventEmitter();

  constructor(
    private readonly tool: SandboxTool,
    private readonly fileSearch = new FileSearchService(),
    private readonly reasoner: AgentReasoner = createDefaultReasoner(),
    private readonly hostCommands = new HostSearchCommandRunner()
  ) {
    this.events.setMaxListeners(100);
  }

  createRun(input: CreateAgentRunInput): AgentRunResult {
    const runId = randomUUID();
    const createdAt = new Date().toISOString();
    const run: AgentRunResult = {
      runId,
      query: input.query,
      createdAt,
      updatedAt: createdAt,
      status: "running",
      reasoningMode: "oci-agent-loop",
      searchedRoots: this.fileSearch.getRoots(),
      iterations: [],
      sandboxSession: {
        requested: input.createSandboxSession === true,
        created: false,
        sessionId: null,
        networkProfile: null
      },
      steps: [
        {
          id: "agent-plan",
          label: "Create agent run plan",
          executionTarget: "agent-orchestrator",
          status: "completed",
          stdout: `Run ${runId} created for prompt: ${input.query}`,
          durationMs: 0
        }
      ],
      fileSearch: null,
      finalAnswer: null
    };

    this.runs.set(runId, run);
    this.emitRun(run);
    void this.executeRun(runId, input);
    return cloneRun(run);
  }

  getRun(runId: string): AgentRunResult | null {
    const run = this.runs.get(runId);
    return run ? cloneRun(run) : null;
  }

  listRuns(): AgentRunResult[] {
    return [...this.runs.values()].map(cloneRun);
  }

  subscribe(runId: string, listener: (run: AgentRunResult) => void): () => void {
    const eventName = this.eventName(runId);
    const wrapped = (run: AgentRunResult) => listener(cloneRun(run));
    this.events.on(eventName, wrapped);
    return () => this.events.off(eventName, wrapped);
  }

  private async executeRun(runId: string, input: CreateAgentRunInput): Promise<void> {
    try {
      if (input.createSandboxSession === true) {
        const sandboxSession = await this.createSandboxProbe(runId, input);
        this.patchRun(runId, { sandboxSession });
      }
      await this.runReasoningLoop(runId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.upsertStep(this.requireRun(runId).runId, {
        id: "agent-run-failed",
        label: "Agent run failed",
        executionTarget: "agent-orchestrator",
        status: "failed",
        stdout: "",
        stderr: message,
        durationMs: 0
      });
      this.patchRun(runId, { status: "failed" });
    }
  }

  private async runReasoningLoop(runId: string): Promise<void> {
    const maxIterations = Number(process.env.AGENT_RUN_MAX_ITERATIONS ?? 8);
    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      const context = this.buildReasoningContext(runId);
      const decisionStepId = `llm-decision-${iteration}`;
      this.upsertStep(runId, {
        id: decisionStepId,
        label: iteration === 1 ? "Understand request and choose tool" : "Reason again and choose next tool",
        executionTarget: "oci-llm",
        status: "running",
        stdout: "Waiting for OCI GenAI agent decision.",
        durationMs: 0
      });
      const decisionStartedAt = Date.now();
      const decision = await this.reasoner.reasonNextAction(context);
      this.upsertStep(runId, {
        id: decisionStepId,
        label: decision.type === "final_answer" ? "Prepare final answer" : `Choose tool: ${decision.type}`,
        executionTarget: "oci-llm",
        status: "completed",
        stdout: decision.reason,
        durationMs: Date.now() - decisionStartedAt
      });

      const observation = await this.applyDecision(runId, iteration, decision);
      this.appendObservation(runId, observation);

      if (decision.type === "final_answer") {
        const finalStatus = decision.status === "found" ? "completed" : decision.status === "not_found" ? "partial" : "failed";
        this.patchRun(runId, {
          status: finalStatus,
          finalAnswer: {
            status: decision.status,
            message: decision.message,
            selectedFileId: decision.selectedFileId
          }
        });
        return;
      }
    }

    this.patchRun(runId, {
      status: "partial",
      finalAnswer: {
        status: "need_help",
        message: "The agent reached the maximum reasoning iterations before a final answer."
      }
    });
  }

  private async applyDecision(runId: string, iteration: number, decision: AgentDecision): Promise<AgentObservation> {
    if (decision.type === "semantic_search") {
      const existingSearch = this.requireRun(runId).fileSearch;
      if (existingSearch?.status === "not_found") {
        const summary =
          "Semantic local file search has already returned no match for the configured roots; skipping a repeated broad search. The next decision should provide a final answer, ask for narrower roots, or use a narrow policy-approved command.";
        this.upsertStep(runId, {
          id: `semantic-search-${iteration}`,
          label: "Skip repeated semantic local file search",
          executionTarget: "host-file-search",
          status: "skipped",
          stdout: summary,
          durationMs: 0
        });
        return { iteration, decision, status: "blocked", summary };
      }
      const startedAt = Date.now();
      const stepId = `semantic-search-${iteration}`;
      this.upsertStep(runId, {
        id: stepId,
        label: "Run semantic local file search",
        executionTarget: "host-file-search",
        status: "running",
        stdout: decision.reason,
        durationMs: 0
      });
      const fileSearch = await this.fileSearch.search(
        decision.query,
        (command) => {
          this.upsertStep(runId, {
            id: `host-${command.id}`,
            label: command.label,
            executionTarget: "host-file-search",
            status: command.status,
            command: command.command,
            stdout: command.stdout,
            stderr: command.stderr,
            durationMs: command.durationMs
          });
        },
        { roots: decision.roots, fileTypes: decision.fileTypes }
      );
      this.patchRun(runId, { fileSearch, searchedRoots: fileSearch.roots });
      const summary =
        fileSearch.status === "found"
          ? `Found ${fileSearch.matches.length} ranked match(es). Best: ${fileSearch.selectedMatch?.fileName}.`
          : `No match found in ${fileSearch.roots.length} configured root(s).`;
      this.upsertStep(runId, {
        id: stepId,
        label: "Inspect semantic search results",
        executionTarget: "host-file-search",
        status: fileSearch.status === "found" ? "completed" : "failed",
        stdout: summary,
        durationMs: Date.now() - startedAt
      });
      return { iteration, decision, status: fileSearch.status === "found" ? "completed" : "failed", summary };
    }

    if (decision.type === "execute_command") {
      const stepId = `${decision.tool}-${iteration}`;
      this.upsertStep(runId, {
        id: stepId,
        label: `Execute ${decision.tool} command`,
        executionTarget: decision.tool,
        status: "running",
        command: decision.command,
        stdout: decision.reason,
        durationMs: 0
      });
      if (decision.tool === "host-file-search") {
        const result = await this.hostCommands.run(decision.command, { cwd: decision.cwd, timeoutMs: decision.timeoutMs });
        const status = result.status === "succeeded" ? "completed" : result.status === "blocked" ? "skipped" : "failed";
        this.upsertStep(runId, {
          id: stepId,
          label: result.status === "blocked" ? "Validate command policy" : "Execute terminal search",
          executionTarget: "host-file-search",
          status,
          command: decision.command,
          stdout: result.stdout,
          stderr: result.stderr,
          durationMs: result.durationMs
        });
        return {
          iteration,
          decision,
          status: result.status === "succeeded" ? "completed" : result.status === "blocked" ? "blocked" : "failed",
          summary: result.status,
          stdout: result.stdout,
          stderr: result.stderr
        };
      }

      const run = this.requireRun(runId);
      if (!run.sandboxSession.sessionId) {
        const sandboxSession = await this.createSandboxProbe(runId, { query: this.requireRun(runId).query, createSandboxSession: true });
        this.patchRun(runId, { sandboxSession });
        if (!sandboxSession.sessionId) {
          const stderr = sandboxSession.error ?? "No Gondolin session is available for VM command execution.";
          this.upsertStep(runId, {
            id: stepId,
            label: "Validate Gondolin command target",
            executionTarget: "gondolin-vm-command",
            status: "skipped",
            command: decision.command,
            stdout: "",
            stderr,
            durationMs: 0
          });
          return { iteration, decision, status: "blocked", summary: stderr, stderr };
        }
      }
      const updatedRun = this.requireRun(runId);
      const sessionId = updatedRun.sandboxSession.sessionId;
      if (!sessionId) {
        const stderr = "No Gondolin session is available for VM command execution.";
        return { iteration, decision, status: "blocked", summary: stderr, stderr };
      }
      const result = await this.tool.runShellCommand({
        sessionId,
        command: decision.command,
        timeoutMs: decision.timeoutMs,
        workingDirectory: decision.cwd
      });
      const status = result.status === "succeeded" ? "completed" : result.status === "blocked" ? "skipped" : "failed";
      this.upsertStep(runId, toCommandStep(stepId, decision.command, result, result.durationMs, status));
      return {
        iteration,
        decision,
        status: result.status === "succeeded" ? "completed" : result.status === "blocked" ? "blocked" : "failed",
        summary: result.status,
        stdout: result.stdout,
        stderr: result.stderr
      };
    }

    this.upsertStep(runId, {
      id: `final-answer-${iteration}`,
      label: "Prepare final answer",
      executionTarget: "agent-orchestrator",
      status: decision.status === "found" ? "completed" : decision.status === "need_help" ? "skipped" : "failed",
      stdout: decision.message,
      durationMs: 0
    });
    return { iteration, decision, status: "completed", summary: decision.message };
  }

  private buildReasoningContext(runId: string): AgentReasoningContext {
    const run = this.requireRun(runId);
    return {
      runId,
      query: run.query,
      searchedRoots: run.searchedRoots,
      sandboxSessionId: run.sandboxSession.sessionId,
      iterations: run.iterations,
      fileSearch: run.fileSearch
    };
  }

  private async createSandboxProbe(
    runId: string,
    input: CreateAgentRunInput
  ): Promise<AgentRunResult["sandboxSession"]> {
    if (input.createSandboxSession === false) {
      this.upsertStep(runId, {
        id: "gondolin-session-skipped",
        label: "Create Gondolin sandbox session",
        executionTarget: "agent-orchestrator",
        status: "skipped",
        stdout: "Gondolin session creation was not requested for this run.",
        durationMs: 0
      });
      return { requested: false, created: false, sessionId: null, networkProfile: null };
    }

    const startedAt = Date.now();
    this.upsertStep(runId, {
      id: "gondolin-session",
      label: "Create Gondolin sandbox session",
      executionTarget: "agent-orchestrator",
      status: "running",
      stdout: "Requesting an isolated Gondolin session for this prompt.",
      durationMs: 0
    });

    try {
      const session = await this.tool.createSandboxSession({
        purpose: `Frontend prompt: ${input.query}`,
        networkProfile: "none",
        ttlSeconds: Number(process.env.AGENT_RUN_SANDBOX_TTL_SECONDS ?? 1800)
      });
      this.upsertStep(runId, {
        id: "gondolin-session",
        label: "Create Gondolin sandbox session",
        executionTarget: "agent-orchestrator",
        status: "completed",
        stdout: `Gondolin session ${session.sessionId} created with ${session.networkProfile} network access.`,
        durationMs: Date.now() - startedAt,
        sessionId: session.sessionId
      });

      const sandboxSession = {
        requested: true,
        created: true,
        sessionId: session.sessionId,
        networkProfile: session.networkProfile
      };
      this.patchRun(runId, { sandboxSession });

      for (const command of ["pwd", "whoami", "hostname"]) {
        const stepId = `gondolin-${command}`;
        const commandStartedAt = Date.now();
        this.upsertStep(runId, {
          id: stepId,
          label: `Run in Gondolin VM: ${command}`,
          executionTarget: "gondolin-vm-command",
          status: "running",
          command,
          stdout: "Command started.",
          durationMs: 0,
          sessionId: session.sessionId
        });
        const result = await this.tool.runShellCommand({
          sessionId: session.sessionId,
          command,
          timeoutMs: 10000,
          workingDirectory: "/workspace"
        });
        this.upsertStep(runId, toCommandStep(stepId, command, result, Date.now() - commandStartedAt));
      }

      return sandboxSession;
    } catch (error) {
      const message = explainGondolinStartupError(error);
      const sandboxSession = {
        requested: true,
        created: false,
        sessionId: null,
        networkProfile: null,
        error: message
      };
      this.upsertStep(runId, {
        id: "gondolin-session",
        label: "Create Gondolin sandbox session",
        executionTarget: "agent-orchestrator",
        status: "failed",
        stdout: "",
        stderr: message,
        durationMs: Date.now() - startedAt
      });
      return sandboxSession;
    }
  }

  private patchRun(runId: string, patch: Partial<AgentRunResult>): void {
    const run = this.requireRun(runId);
    Object.assign(run, patch, { updatedAt: new Date().toISOString() });
    this.emitRun(run);
  }

  private upsertStep(runId: string, step: AgentRunStep): void {
    const run = this.requireRun(runId);
    const existingIndex = run.steps.findIndex((candidate) => candidate.id === step.id);
    if (existingIndex >= 0) {
      run.steps[existingIndex] = step;
    } else {
      run.steps.push(step);
    }
    run.updatedAt = new Date().toISOString();
    this.emitRun(run);
  }

  private appendObservation(runId: string, observation: AgentObservation): void {
    const run = this.requireRun(runId);
    run.iterations.push(observation);
    run.updatedAt = new Date().toISOString();
    this.emitRun(run);
  }

  private requireRun(runId: string): AgentRunResult {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Unknown agent run: ${runId}`);
    return run;
  }

  private emitRun(run: AgentRunResult): void {
    this.events.emit(this.eventName(run.runId), cloneRun(run));
  }

  private eventName(runId: string): string {
    return `run:${runId}`;
  }
}

function toCommandStep(
  stepId: string,
  command: string,
  result: CommandResult,
  durationMs: number,
  status: AgentRunStepStatus = result.status === "succeeded" ? "completed" : "failed"
): AgentRunStep {
  return {
    id: stepId,
    label: `Run in Gondolin VM: ${command}`,
    executionTarget: "gondolin-vm-command",
    status,
    command,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs,
    sessionId: result.sessionId
  };
}

function explainGondolinStartupError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/EPERM: operation not permitted, symlink/i.test(message)) {
    return `${message}. Windows denied Gondolin image-cache symlink creation; run real Gondolin from WSL2 Ubuntu or start the server with SANDBOX_DRY_RUN=true for Windows-local UI testing.`;
  }
  return message;
}

function cloneRun(run: AgentRunResult): AgentRunResult {
  return {
    ...run,
    sandboxSession: { ...run.sandboxSession },
    searchedRoots: [...run.searchedRoots],
    iterations: run.iterations.map((iteration) => ({
      ...iteration,
      decision: { ...iteration.decision }
    })),
    steps: run.steps.map((step) => ({ ...step })),
    fileSearch: run.fileSearch
      ? {
          ...run.fileSearch,
          terminal: { ...run.fileSearch.terminal },
          roots: [...run.fileSearch.roots],
          commands: run.fileSearch.commands.map((command) => ({ ...command })),
          matches: run.fileSearch.matches.map((match) => ({ ...match })),
          selectedMatch: run.fileSearch.selectedMatch ? { ...run.fileSearch.selectedMatch } : null
        }
      : null,
    finalAnswer: run.finalAnswer ? { ...run.finalAnswer } : null
  };
}
