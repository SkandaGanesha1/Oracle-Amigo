import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, ChevronDown, ChevronRight, Copy, Check } from "lucide-react";

interface ReasoningStep {
  id: string;
  title: string;
  content: string;
  details?: Record<string, unknown>;
  durationMs?: number;
}

interface AgenticReasoningProps {
  steps: ReasoningStep[];
  className?: string;
}

function summarizeSteps(steps: ReasoningStep[]): string {
  const locationCount = new Set(steps.map((s) => s.title).filter((t) => t.toLowerCase().includes("search") || t.toLowerCase().includes("location"))).size;
  const matchCount = steps.filter((s) => s.content.toLowerCase().includes("found") || s.content.toLowerCase().includes("match") || s.content.toLowerCase().includes("candidate")).length;
  if (matchCount > 0) {
    return `Agent searched ${locationCount || "3"} locations and found ${matchCount} match${matchCount !== 1 ? "es" : ""}`;
  }
  return `Agent took ${steps.length} reasoning step${steps.length !== 1 ? "s" : ""}`;
}

export function AgenticReasoning({ steps, className }: AgenticReasoningProps) {
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [expandedChain, setExpandedChain] = useState(false);
  const summary = summarizeSteps(steps);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (steps.length === 0) return null;

  const handleCopy = async (content: string, id: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className={`rounded-xl border border-oa-border bg-oa-surface ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setExpandedChain(!expandedChain)}
        aria-expanded={expandedChain}
        className="flex min-h-[48px] w-full items-center gap-2 border-b border-oa-border px-4 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-oa-blue"
      >
        {expandedChain ? <ChevronDown className="h-4 w-4 text-oa-text-muted" /> : <ChevronRight className="h-4 w-4 text-oa-text-muted" />}
        <Brain className="h-4 w-4 text-oa-purple" />
        <span className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">
          Reasoning Chain
        </span>
        <span className="ml-auto text-[10px] text-oa-text-muted">{steps.length} steps</span>
      </button>

      <AnimatePresence initial={false}>
        {!expandedChain && (
          <motion.div
            key="summary"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-2.5">
              <p className="text-[11px] text-oa-text-secondary leading-relaxed">{summary}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {expandedChain && (
          <motion.div
            key="expanded"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-1 p-2">
          {steps.map((step, index) => {
            const isOpen = expandedStep === step.id;

            return (
              <div key={step.id} className="overflow-hidden rounded-lg border border-oa-border bg-oa-bg-elevated">
                <button
                  type="button"
                  onClick={() => setExpandedStep(isOpen ? null : step.id)}
                  aria-expanded={isOpen}
                  aria-controls={`reasoning-${step.id}`}
                  className="flex min-h-[48px] w-full items-center justify-between gap-2 p-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-oa-blue"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-oa-purple/10 text-[9px] font-bold text-oa-purple">
                      {index + 1}
                    </span>
                    <span className="text-xs font-medium text-oa-text truncate">{step.title}</span>
                    {step.durationMs !== undefined && (
                      <span className="shrink-0 text-[10px] text-oa-text-muted">
                        {step.durationMs >= 1000 ? `${(step.durationMs / 1000).toFixed(1)}s` : `${step.durationMs}ms`}
                      </span>
                    )}
                  </div>
                  {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-oa-text-muted" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-oa-text-muted" />}
                </button>

                {isOpen && (
                  <div id={`reasoning-${step.id}`} className="border-t border-oa-border">
                    <div className="relative p-3">
                      <p className="pr-6 text-[11px] text-oa-text-secondary leading-relaxed whitespace-pre-wrap">
                        {step.content}
                      </p>
                      <button
                        type="button"
                        onClick={() => handleCopy(step.content, step.id)}
                        className="absolute right-2 top-2 flex min-h-[48px] min-w-[48px] items-center justify-center text-oa-text-muted hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
                        aria-label="Copy step content"
                      >
                        {copiedId === step.id ? <Check className="h-3 w-3 text-oa-green" /> : <Copy className="h-3 w-3" />}
                      </button>
                    </div>
                    {step.details && (
                      <div className="border-t border-oa-border/50 bg-oa-surface-2 px-3 py-2">
                        <pre className="overflow-auto whitespace-pre-wrap break-words text-[10px] font-mono text-oa-text-muted max-h-32">
                          {JSON.stringify(step.details, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        </motion.div>
      )}
    </AnimatePresence>
    </div>
  );
}
