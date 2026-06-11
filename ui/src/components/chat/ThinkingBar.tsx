import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Brain, CheckCircle2, ChevronDown, ChevronRight, EyeOff, LockKeyhole, ShieldCheck, XCircle } from "lucide-react";
import type { ChainOfThoughtStep, ThinkingBarState } from "../../types";

interface ThinkingBarProps {
  state: ThinkingBarState;
  privacyMasked?: boolean;
  className?: string;
}

function stepIcon(status: ChainOfThoughtStep["status"]) {
  if (status === "failed") return <XCircle className="h-3.5 w-3.5 text-oa-red" aria-hidden="true" />;
  if (status === "completed") return <CheckCircle2 className="h-3.5 w-3.5 text-oa-green" aria-hidden="true" />;
  return <span className="h-2 w-2 animate-pulse rounded-full bg-oa-blue" aria-hidden="true" />;
}

function maskTrace(trace: string): string {
  return trace
    .replace(/[A-Za-z]:\\[^\r\n"]*/g, "Local path hidden")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[ID]")
    .replace(/\b(?:Bearer|token|password|secret|key)\s*[:=]\s*\S+/gi, "[secret redacted]");
}

export function ThinkingBar({ state, privacyMasked = true, className }: ThinkingBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const activeStep = state.steps.find((step) => step.id === state.currentStepId) ?? state.steps.at(-1);

  const statusLabel = useMemo(() => {
    if (!state.steps.length) return "Agent is preparing";
    if (state.isActive) return activeStep?.description ?? state.streamingText ?? "Agent is working";
    const failed = state.steps.some((step) => step.status === "failed");
    return failed ? "Agent needs attention" : "Agent reasoning complete";
  }, [activeStep?.description, state.isActive, state.steps, state.streamingText]);

  function toggleStep(stepId: string) {
    setExpandedSteps((current) => {
      const next = new Set(current);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  }

  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={`w-full rounded-xl border border-oa-blue/20 bg-oa-blue/5 px-4 py-3 shadow-sm ${className ?? ""}`}
      role="status"
      aria-live="polite"
      aria-label="Continuous agent thinking"
    >
      <div className="flex items-start gap-3">
        <div className="relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-oa-blue/10">
          {state.isActive && <span className="absolute h-8 w-8 animate-ping rounded-full bg-oa-blue/20" />}
          <Brain className="h-4 w-4 text-oa-blue" aria-hidden="true" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-oa-text-secondary">{statusLabel}</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-oa-green/20 bg-oa-green/10 px-2 py-0.5 text-[10px] font-medium text-oa-green">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              Trusted local trace
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-oa-border bg-oa-surface/70 px-2 py-0.5 text-[10px] text-oa-text-muted">
              {privacyMasked ? <EyeOff className="h-3 w-3" aria-hidden="true" /> : <LockKeyhole className="h-3 w-3" aria-hidden="true" />}
              {privacyMasked ? "Private details masked" : "Technical trace visible"}
            </span>
          </div>

          <p className="mt-1 text-xs leading-relaxed text-oa-text-muted">
            {state.summary || state.streamingText || "The agent is combining search, policy, and response preparation in one continuous run."}
          </p>

          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-oa-surface-2" aria-hidden="true">
            <div
              className="h-full rounded-full bg-gradient-to-r from-oa-blue to-oa-green transition-all duration-500"
              style={{ width: `${Math.max(5, Math.min(100, state.progress))}%` }}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg text-oa-text-muted transition-colors hover:bg-oa-surface hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
          aria-expanded={expanded}
          aria-label={expanded ? "Hide agent reasoning trace" : "Show agent reasoning trace"}
          title={expanded ? "Hide trace" : "Show trace"}
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-oa-border/50 pt-3">
          {state.steps.map((step) => {
            const stepOpen = expandedSteps.has(step.id);
            return (
              <div key={step.id} className="rounded-lg border border-oa-border/70 bg-oa-bg-elevated/70 p-2.5">
                <button
                  type="button"
                  onClick={() => toggleStep(step.id)}
                  className="flex w-full items-center gap-2 text-left text-xs text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
                  aria-expanded={stepOpen}
                >
                  {stepIcon(step.status)}
                  <span className="min-w-0 flex-1 truncate">{step.description}</span>
                  {typeof step.confidence === "number" && (
                    <span className="text-[10px] text-oa-text-muted">{Math.round(step.confidence * 100)}%</span>
                  )}
                  {stepOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
                {stepOpen && (
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-black/20 p-2 font-mono text-[10px] leading-relaxed text-oa-text-muted">
                    {privacyMasked ? maskTrace(step.technicalTrace) : step.technicalTrace}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </motion.section>
  );
}
