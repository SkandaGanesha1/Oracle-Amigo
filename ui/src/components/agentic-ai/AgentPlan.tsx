import { useState, useMemo } from "react";
import { CheckCircle2, CircleDotDashed, Circle, CircleX, CircleAlert, ChevronDown, ListTree, Shield, Timer, FileText } from "lucide-react";
import type { AgentRunStep, AgentRunStatus } from "../../api/types";

interface AgentPlanProps {
  steps: AgentRunStep[];
  status: AgentRunStatus;
  className?: string;
}

const fileRegex = /([a-zA-Z]:\\[^\s"']+|\/[^\s"']+\.[a-zA-Z0-9]+)/g;

function extractFiles(text: string): string[] {
  const matches = text.match(fileRegex);
  return matches ? [...new Set(matches)].slice(0, 5) : [];
}

interface PermissionCheckpoint {
  stepId: string;
  label: string;
  description: string;
}

function inferCheckpoints(steps: AgentRunStep[]): PermissionCheckpoint[] {
  const checkpoints: PermissionCheckpoint[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.executionTarget === "host-file-search") {
      checkpoints.push({
        stepId: step.id,
        label: "File access required",
        description: "This step needs to read files on your device.",
      });
    }
    if (step.command && (step.command.includes("rm ") || step.command.includes("del ") || step.command.includes("write"))) {
      checkpoints.push({
        stepId: step.id,
        label: "Write permission required",
        description: "This step may modify files on your device.",
      });
    }
    if (step.executionTarget === "gondolin-vm-command") {
      checkpoints.push({
        stepId: step.id,
        label: "Command execution",
        description: "This step runs a command on your device.",
      });
    }
  }
  return checkpoints;
}

export function AgentPlan({ steps, status, className }: AgentPlanProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const isRunning = status === "running";

  const toggleExpand = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const activeIndex = steps.findIndex((s) => s.status === "running");
  const checkpoints = useMemo(() => inferCheckpoints(steps), [steps]);
  const totalEstimatedMs = useMemo(() => {
    const completed = steps.filter((s) => s.durationMs > 0);
    if (completed.length === 0) return null;
    const avg = completed.reduce((s, c) => s + c.durationMs, 0) / completed.length;
    return Math.round(avg * steps.length);
  }, [steps]);

  const dataScopePerStep = useMemo(() => {
    return steps.map((step) => ({
      stepId: step.id,
      files: extractFiles((step.stdout ?? "") + " " + (step.stderr ?? "") + " " + (step.command ?? "")),
    }));
  }, [steps]);

  return (
    <div className={`rounded-xl border border-oa-border bg-oa-surface ${className ?? ""}`}>
      <div className="flex items-center gap-2 border-b border-oa-border px-4 py-2.5">
        <ListTree className="h-4 w-4 text-oa-blue" />
        <span className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">
          Agent Plan
        </span>
        <span className="ml-auto flex items-center gap-2">
          {totalEstimatedMs && (
            <span className="flex items-center gap-1 text-[10px] text-oa-text-muted">
              <Timer className="h-3 w-3" />
              ~{Math.round(totalEstimatedMs / 1000)}s total
            </span>
          )}
          <span className="text-[10px] text-oa-text-muted">{steps.length} steps</span>
        </span>
      </div>

      <div className="p-3">
        {steps.length === 0 ? (
          <p className="py-3 text-center text-xs text-oa-text-disabled">No steps defined</p>
        ) : (
          <div className="relative">
            {steps.map((step, index) => {
              const isExpanded = expanded[step.id] ?? false;
              const isActive = index === activeIndex;
              const isPast = index < activeIndex;
              const isFuture = index > activeIndex;
              const isLast = index === steps.length - 1;
              const stepCheckpoints = checkpoints.filter((c) => c.stepId === step.id);
              const stepData = dataScopePerStep.find((d) => d.stepId === step.id);

              const StepIcon = step.status === "completed"
                ? CheckCircle2
                : step.status === "running"
                  ? CircleDotDashed
                  : step.status === "failed"
                    ? CircleX
                    : step.status === "skipped"
                      ? CircleAlert
                      : Circle;

              const iconColor = step.status === "completed"
                ? "text-oa-green"
                : step.status === "running"
                  ? "text-oa-blue"
                  : step.status === "failed"
                    ? "text-oa-red"
                    : step.status === "skipped"
                      ? "text-oa-amber"
                      : "text-oa-text-disabled";

              return (
                <div key={step.id} className="relative flex gap-3 pb-1">
                  {!isLast && (
                    <div className={`absolute left-[11px] top-6 h-full w-px ${isPast ? "bg-oa-green/30" : isActive ? "bg-oa-blue/30" : "bg-oa-border"}`} />
                  )}
                  <div className="relative z-10 mt-1">
                    <StepIcon className={`h-[18px] w-[18px] ${iconColor} ${step.status === "running" ? "animate-spin" : ""}`} />
                  </div>
                  <div className="min-w-0 flex-1 pb-3">
                    <button
                      type="button"
                      onClick={() => toggleExpand(step.id)}
                      className="flex w-full items-center justify-between gap-2 text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <span className={`text-sm font-medium ${isFuture ? "text-oa-text-disabled" : "text-oa-text"}`}>
                          {step.label}
                        </span>
                        <span className="ml-2 rounded bg-oa-surface-2 px-1.5 py-0.5 text-[10px] text-oa-text-muted">
                          {step.executionTarget.replace(/-/g, " ")}
                        </span>
                        {stepData && stepData.files.length > 0 && (
                          <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-oa-blue/10 px-1 py-0.5 text-[9px] text-oa-blue">
                            <FileText className="h-2.5 w-2.5" />
                            {stepData.files.length}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {step.durationMs > 0 && (
                          <span className="text-[10px] text-oa-text-muted">{step.durationMs}ms</span>
                        )}
                        <ChevronDown className={`h-3.5 w-3.5 text-oa-text-muted transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                      </div>
                    </button>

                    {stepCheckpoints.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {stepCheckpoints.map((cp) => (
                          <div
                            key={cp.label}
                            className="flex items-center gap-1 rounded-md bg-oa-amber/5 border border-oa-amber/20 px-2 py-0.5"
                            title={cp.description}
                          >
                            <Shield className="h-3 w-3 text-oa-amber" />
                            <span className="text-[9px] text-oa-amber font-medium">{cp.label}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {isExpanded && (
                      <div className="mt-2 space-y-2">
                        {step.command && (
                          <div className="overflow-hidden rounded border border-oa-border">
                            <pre className="overflow-auto whitespace-pre-wrap break-words bg-oa-bg p-2 text-[11px] leading-5 text-oa-cyan font-mono">
                              {step.command}
                            </pre>
                          </div>
                        )}
                        {step.stdout && (
                          <div className="overflow-hidden rounded border border-oa-border">
                            <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words bg-oa-bg p-2 text-[11px] leading-5 text-oa-text-secondary font-mono">
                              {step.stdout}
                            </pre>
                          </div>
                        )}
                        {step.stderr && (
                          <div className="overflow-hidden rounded border border-oa-red/20">
                            <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words bg-oa-red/5 p-2 text-[11px] leading-5 text-oa-red font-mono">
                              {step.stderr}
                            </pre>
                          </div>
                        )}

                        {stepData && stepData.files.length > 0 && (
                          <div className="rounded border border-oa-blue/10 bg-oa-blue/5 px-2 py-1.5">
                            <span className="text-[9px] font-medium text-oa-blue uppercase tracking-wider">Data scope</span>
                            <ul className="mt-0.5 space-y-0.5">
                              {stepData.files.map((f) => (
                                <li key={f} className="truncate text-[10px] text-oa-text-muted font-mono">{f}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isRunning && steps.length > 0 && (
        <div className="flex items-center gap-2 border-t border-oa-border px-4 py-2">
          <div className="flex gap-0.5">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-oa-blue" style={{ animationDelay: "0ms" }} />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-oa-blue" style={{ animationDelay: "150ms" }} />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-oa-blue" style={{ animationDelay: "300ms" }} />
          </div>
          <span className="text-[10px] text-oa-text-muted">
            Executing step {activeIndex + 1} of {steps.length}
          </span>
          {totalEstimatedMs && (
            <span className="text-[10px] text-oa-text-muted ml-auto">
              <Timer className="h-3 w-3 inline mr-0.5" />
              ~{Math.round(totalEstimatedMs / 1000)}s
            </span>
          )}
        </div>
      )}
    </div>
  );
}
