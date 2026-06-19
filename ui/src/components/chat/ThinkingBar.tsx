import { useMemo, useState } from "react";
import { motion } from "../primitives/MotionPrimitives";
import { CheckCircle2, ChevronRight, XCircle } from "lucide-react";
import { TextShimmer } from "@/components/prompt-kit/text-shimmer";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtItem,
  ChainOfThoughtStep,
  ChainOfThoughtTrigger,
} from "@/components/prompt-kit/chain-of-thought";
import type { ChainOfThoughtStep as ThinkingStep, ThinkingBarState } from "../../types";

interface ThinkingBarProps {
  state: ThinkingBarState;
  privacyMasked?: boolean;
  className?: string;
}

function stepIcon(status: ThinkingStep["status"]) {
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
  const activeStep = state.steps.find((step) => step.id === state.currentStepId) ?? state.steps.at(-1);

  const statusLabel = useMemo(() => {
    if (!state.steps.length) return "Agent is preparing";
    if (state.isActive) return activeStep?.description ?? state.streamingText ?? "Agent is working";
    const failed = state.steps.some((step) => step.status === "failed");
    return failed ? "Agent needs attention" : "Agent reasoning complete";
  }, [activeStep?.description, state.isActive, state.steps, state.streamingText]);

  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={`w-full ${className ?? ""}`}
      role="status"
      aria-live="polite"
      aria-label="Continuous agent thinking"
    >
      {privacyMasked && <span className="sr-only">Private details masked</span>}
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="inline-flex items-center gap-1 text-left text-sm font-medium text-oa-text-secondary transition-colors hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
        aria-expanded={expanded}
        aria-label={expanded ? "Hide agent reasoning trace" : "Show agent reasoning trace"}
      >
        {state.isActive ? (
          <TextShimmer className="text-sm font-medium" spread={18}>{statusLabel}</TextShimmer>
        ) : (
          <span>{statusLabel}</span>
        )}
        <ChevronRight
          className={`h-4 w-4 text-oa-text-muted transition-transform ${expanded ? "rotate-90" : ""}`}
          aria-hidden="true"
        />
      </button>

      {expanded && (
        <ChainOfThought className="mt-2">
          {(state.steps.length ? state.steps : [{
            id: "preparing",
            description: "Preparing local reasoning trace",
            status: state.isActive ? "pending" : "completed",
            technicalTrace: state.summary || state.streamingText || "No detailed trace is available yet.",
            timestamp: new Date().toISOString(),
          } satisfies ThinkingStep]).map((step) => (
            <ChainOfThoughtStep
              key={step.id}
              defaultOpen={step.id === state.currentStepId || step.status === "pending"}
            >
              <ChainOfThoughtTrigger
                leftIcon={stepIcon(step.status)}
                className="text-xs text-oa-text-secondary hover:text-oa-text"
              >
                <span className="min-w-0 truncate">{step.description}</span>
                {typeof step.confidence === "number" && (
                  <span className="ml-2 text-[10px] text-oa-text-muted">{Math.round(step.confidence * 100)}%</span>
                )}
              </ChainOfThoughtTrigger>
              <ChainOfThoughtContent className="text-oa-text-muted">
                <ChainOfThoughtItem className="max-h-40 overflow-auto font-mono text-[10px] leading-relaxed text-oa-text-muted">
                  {privacyMasked ? maskTrace(step.technicalTrace) : step.technicalTrace}
                </ChainOfThoughtItem>
              </ChainOfThoughtContent>
            </ChainOfThoughtStep>
          ))}
        </ChainOfThought>
      )}
    </motion.section>
  );
}
