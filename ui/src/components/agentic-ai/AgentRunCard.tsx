import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { CheckCircle, Brain, Loader2, XCircle, SkipForward, Pause, StopCircle, FileText, HelpCircle, Timer, ChevronDown, ChevronRight } from "lucide-react";
import { ThinkingBar } from "./ThinkingBar";
import { AgenticReasoning } from "./AgenticReasoning";
import { AgenticToolCall } from "./AgenticToolCall";
import { Steps, StepsTrigger, StepsContent } from "~/components/ui/steps";
import { readableFilePath } from "../../lib/safeText";
import type { AgentRunResult, AgentRunStep } from "../../api/types";

interface AgentRunCardProps {
  run: AgentRunResult;
  onStop?: () => void;
  onPause?: () => void;
}

const fileRegex = /([a-zA-Z]:\\[^\s"']+|\/[^\s"']+\.[a-zA-Z0-9]+)/g;

function extractFiles(text: string): string[] {
  const matches = text.match(fileRegex);
  return matches ? [...new Set(matches)].slice(0, 5) : [];
}

function estimatedTotalMs(steps: AgentRunStep[]): number | null {
  const completed = steps.filter((s) => s.durationMs > 0);
  if (completed.length < 2) return null;
  const avg = completed.reduce((s, c) => s + c.durationMs, 0) / completed.length;
  return Math.round(avg * steps.length);
}

function estimatedRemainingMs(steps: AgentRunStep[], nowMs: number): number | null {
  const total = estimatedTotalMs(steps);
  if (total === null) return null;
  const elapsed = steps.reduce((s, c) => s + (c.status === "completed" ? c.durationMs : nowMs), 0);
  return Math.max(0, total - elapsed);
}

function stepExplanation(step: AgentRunStep): string {
  const targetLabel: Record<string, string> = {
    "agent-orchestrator": "The orchestrator is coordinating sub-tasks and routing work to the right tool.",
    "oci-llm": "The LLM is generating a response or analyzing information.",
    "gondolin-vm-command": "A command is being executed on the device to retrieve or process data.",
    "host-file-search": "Searching local files on this device for matching documents.",
  };
  return targetLabel[step.executionTarget] ?? `Executing: ${step.executionTarget}`;
}

function runSuggestions(run: AgentRunResult): string | null {
  for (const step of run.steps) {
    const out = (step.stdout ?? "") + " " + (step.stderr ?? "");
    const lower = out.toLowerCase();
    if (lower.includes("0 candidates") || lower.includes("no results") || lower.includes("nothing found") || lower.includes("could not find")) {
      return "Try a different search term or request a specific file by name.";
    }
    if (lower.includes("not available") || lower.includes("unreachable") || lower.includes("connection refused")) {
      return "Check if the remote agent is online and try again.";
    }
  }
  return null;
}

export function AgentRunCard({ run, onStop, onPause }: AgentRunCardProps) {
  const isRunning = run.status === "running";
  const isFailed = run.status === "failed";
  const isCompleted = run.status === "completed" || run.status === "partial";
  const suggestion = (!isRunning && !isCompleted) ? runSuggestions(run) : null;

  const nowMs = useMemo(() => Date.now(), []);
  const remaining = isRunning ? estimatedRemainingMs(run.steps, nowMs) : null;

  const allTouchedFiles = useMemo(() => {
    const files = new Set<string>();
    for (const step of run.steps) {
      if (step.stdout) extractFiles(step.stdout).forEach((f) => files.add(f));
      if (step.stderr) extractFiles(step.stderr).forEach((f) => files.add(f));
      if (step.command) extractFiles(step.command).forEach((f) => files.add(f));
    }
    return [...files];
  }, [run.steps]);

  const reasoningSteps = useMemo(() => {
    return run.steps
      .filter((s) => s.executionTarget === "oci-llm" && s.stdout)
      .map((s) => ({
        id: s.id,
        title: s.label,
        content: s.stdout,
        durationMs: s.durationMs,
      }));
  }, [run.steps]);

  const toolCallSteps = useMemo(() => {
    return run.steps.filter((s) => s.executionTarget === "gondolin-vm-command");
  }, [run.steps]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="flex flex-col gap-3"
      role="region"
      aria-label="Agent progress card"
    >
      {isRunning && (
        <ThinkingBar text="Deep reasoning in progress" />
      )}

      {isRunning && (
        <div className="flex items-center gap-2" role="status" aria-live="polite" aria-label="Agent run in progress">
          {onPause && (
            <button
              type="button"
              onClick={onPause}
              className="flex min-h-[48px] items-center gap-1.5 rounded-md border border-oa-border bg-oa-surface px-2.5 py-1.5 text-[11px] text-oa-text-muted hover:text-oa-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
            >
              <Pause className="h-3.5 w-3.5" />
              Pause
            </button>
          )}
          {onStop && (
            <button
              type="button"
              onClick={onStop}
              className="flex min-h-[48px] items-center gap-1.5 rounded-md border border-oa-red/30 bg-oa-red/5 px-2.5 py-1.5 text-[11px] text-oa-red hover:bg-oa-red/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
            >
              <StopCircle className="h-3.5 w-3.5" />
              Cancel
            </button>
          )}
          {remaining !== null && remaining > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-oa-text-muted ml-auto">
              <Timer className="h-3 w-3" />
              ~{Math.round(remaining / 1000)}s remaining
            </span>
          )}
        </div>
      )}

      {isFailed && (
        <div className="flex items-center gap-2 rounded-lg border border-oa-border bg-oa-surface px-3 py-2">
          <XCircle className="h-4 w-4 text-oa-red" />
          <span className="text-sm text-oa-text-secondary">Agent run failed</span>
        </div>
      )}

      {reasoningSteps.length > 0 && (
        <AgenticReasoning steps={reasoningSteps} />
      )}

      {toolCallSteps.length > 0 && toolCallSteps.slice(0, 3).map((step) => (
        <AgenticToolCall
          key={step.id}
          toolName={step.label}
          params={[
            ...(step.command ? [{ name: "command", value: step.command, type: "string" }] : []),
            ...(step.sessionId ? [{ name: "sessionId", value: step.sessionId, type: "string" }] : []),
          ]}
          result={{
            status: step.status === "completed" ? "success" : step.status === "failed" ? "error" : "running",
            output: step.stdout,
            error: step.stderr,
            durationMs: step.durationMs,
          }}
        />
      ))}

      {run.steps.length > 0 && (
        <Steps defaultOpen={!isRunning}>
          <StepsTrigger leftIcon={<Brain className="card-icon h-4 w-4" />}>
            <span className="text-xs font-medium text-oa-text-secondary">Agent Steps ({run.steps.length})</span>
          </StepsTrigger>
          <StepsContent>
            <div className="space-y-2">
              {run.steps.map((step) => (
                <StepItem key={step.id} step={step} />
              ))}
            </div>
          </StepsContent>
        </Steps>
      )}

      {allTouchedFiles.length > 0 && (
        <div className="rounded-lg border border-oa-border/50 bg-oa-surface px-3 py-2">
          <div className="flex items-center gap-1.5 mb-1">
            <FileText className="h-3.5 w-3.5 text-oa-blue" />
            <span className="text-[11px] font-medium text-oa-text-secondary">Data touched</span>
            <span className="text-[10px] text-oa-text-muted ml-auto">{allTouchedFiles.length} file{allTouchedFiles.length > 1 ? "s" : ""}</span>
          </div>
          <ul className="space-y-0.5">
            {allTouchedFiles.map((file) => (
              <li key={file} className="truncate text-[10px] text-oa-text-muted font-mono pl-4">
                {readableFilePath(file)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {run.finalAnswer && isCompleted && (
        <div className="rounded-lg border border-oa-border bg-oa-surface p-3">
          <div className="mb-1 flex items-center gap-1.5">
            <CheckCircle className="h-4 w-4 text-oa-green" />
            <span className="text-xs font-medium text-oa-text-secondary">Final Answer</span>
            {run.finalAnswer.status === "found" && <span className="rounded bg-oa-green/20 px-1 py-0.5 text-[9px] text-oa-green font-medium uppercase">Found</span>}
            {run.finalAnswer.status === "need_help" && <span className="rounded bg-oa-amber/20 px-1 py-0.5 text-[9px] text-oa-amber font-medium uppercase">Needs Help</span>}
            {run.finalAnswer.status === "not_found" && <span className="rounded bg-oa-red/20 px-1 py-0.5 text-[9px] text-oa-red font-medium uppercase">Not Found</span>}
          </div>
          <p className="text-sm text-oa-text">{run.finalAnswer.message}</p>
        </div>
      )}

      {suggestion && (
        <p className="text-xs text-oa-text-muted border-t border-oa-border/30 pt-2">
          {suggestion}
        </p>
      )}
    </motion.div>
  );
}

function StepItem({ step }: { step: AgentRunStep }) {
  const [showWhy, setShowWhy] = useState(false);
  const isRunning = step.status === "running";
  const isCompleted = step.status === "completed";
  const isFailed = step.status === "failed";
  const isSkipped = step.status === "skipped";

  const StatusIcon = isCompleted
    ? CheckCircle
    : isRunning
      ? Loader2
      : isFailed
        ? XCircle
        : SkipForward;

  const statusColor = isCompleted
    ? "text-oa-green"
    : isRunning
      ? "text-oa-blue"
      : isFailed
        ? "text-oa-red"
        : "text-oa-text-muted";

  const targetLabel: Record<string, string> = {
    "agent-orchestrator": "Orchestrator",
    "oci-llm": "LLM",
    "gondolin-vm-command": "Command",
    "host-file-search": "File Search",
  };

  const stepFiles = useMemo(() => {
    const files = new Set<string>();
    if (step.stdout) extractFiles(step.stdout).forEach((f) => files.add(f));
    if (step.stderr) extractFiles(step.stderr).forEach((f) => files.add(f));
    if (step.command) extractFiles(step.command).forEach((f) => files.add(f));
    return [...files];
  }, [step]);

  return (
    <div className="rounded-lg border border-oa-border bg-oa-bg-elevated">
      <Steps>
        <StepsTrigger
          leftIcon={<StatusIcon className={`h-4 w-4 ${statusColor} ${isRunning ? "animate-spin" : ""}`} />}
        >
          <div className="flex items-center gap-2 text-left">
            <span className="text-xs font-medium text-oa-text">{step.label}</span>
            <span className="rounded bg-oa-surface-2 px-1.5 py-0.5 text-[10px] text-oa-text-muted">
              {targetLabel[step.executionTarget] ?? step.executionTarget}
            </span>
            {step.durationMs > 0 && (
              <span className="text-[10px] text-oa-text-muted">
                {step.durationMs >= 1000 ? `${(step.durationMs / 1000).toFixed(1)}s` : `${step.durationMs}ms`}
              </span>
            )}
          </div>
        </StepsTrigger>
        <StepsContent>
          {stepFiles.length > 0 && (
            <div className="mb-2 rounded border border-oa-blue/10 bg-oa-blue/5 px-2 py-1.5">
              <span className="text-[9px] font-medium text-oa-blue uppercase tracking-wider">Files accessed</span>
              <ul className="mt-0.5 space-y-0.5">
                {stepFiles.map((f) => (
                  <li key={f} className="truncate text-[10px] text-oa-text-muted font-mono">{readableFilePath(f)}</li>
                ))}
              </ul>
            </div>
          )}

          {step.command && (
            <div className="mb-2 overflow-hidden rounded border border-oa-border">
              <pre className="overflow-auto whitespace-pre-wrap break-words bg-oa-bg p-2 text-[11px] leading-5 text-oa-cyan font-mono">
                {step.command}
              </pre>
            </div>
          )}
          {step.stdout && (
            <div className="mb-2 overflow-hidden rounded border border-oa-border">
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words bg-oa-bg p-2 text-[11px] leading-5 text-oa-text-secondary font-mono">
                {step.stdout}
              </pre>
            </div>
          )}
          {step.stderr && (
            <div className="mb-2 overflow-hidden rounded border border-oa-red/20">
              <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words bg-oa-red/5 p-2 text-[11px] leading-5 text-oa-red font-mono">
                {step.stderr}
              </pre>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowWhy(!showWhy)}
            aria-expanded={showWhy}
            aria-controls={`why-${step.id}`}
            className="flex min-h-[48px] items-center gap-1 text-[10px] text-oa-text-muted hover:text-oa-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-oa-blue"
          >
            <HelpCircle className="h-3 w-3" />
            {showWhy ? "Hide explanation" : "Why did the agent do this?"}
          </button>
          {showWhy && (
            <p id={`why-${step.id}`} className="mt-1 rounded bg-oa-surface-2 px-2 py-1.5 text-[10px] text-oa-text-muted leading-relaxed">
              {stepExplanation(step)}
            </p>
          )}
        </StepsContent>
      </Steps>
    </div>
  );
}
