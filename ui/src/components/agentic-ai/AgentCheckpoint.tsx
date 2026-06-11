import { useState } from "react";
import { RotateCcw, CheckCircle2, Clock, ChevronDown, Camera } from "lucide-react";

interface Checkpoint {
  id: string;
  label: string;
  timestamp: string;
  description?: string;
  snapshot?: Record<string, unknown>;
}

interface AgentCheckpointProps {
  checkpoints: Checkpoint[];
  onRestore?: (id: string) => void;
  className?: string;
}

export function AgentCheckpoint({ checkpoints, onRestore, className }: AgentCheckpointProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (checkpoints.length === 0) return null;

  return (
    <div className={`rounded-xl border border-oa-border bg-oa-surface ${className ?? ""}`}>
      <div className="flex items-center gap-2 border-b border-oa-border px-4 py-2.5">
        <Camera className="h-4 w-4 text-oa-purple" />
        <span className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">
          Checkpoints
        </span>
        <span className="ml-auto text-[10px] text-oa-text-muted">{checkpoints.length}</span>
      </div>

      <div className="space-y-1 p-2">
        {checkpoints.map((cp) => {
          const isOpen = expanded === cp.id;

          return (
            <div key={cp.id} className="rounded-lg border border-oa-border bg-oa-bg-elevated">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : cp.id)}
                aria-expanded={isOpen}
                aria-controls={`cp-${cp.id}`}
                className="flex min-h-[48px] w-full items-center justify-between gap-2 p-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-oa-blue"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-oa-green" />
                  <div className="min-w-0">
                    <span className="text-xs font-medium text-oa-text">{cp.label}</span>
                    <p className="text-[10px] text-oa-text-muted">
                      {new Date(cp.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {onRestore && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onRestore(cp.id); }}
                      className="flex min-h-[48px] items-center gap-1 rounded border border-oa-border bg-oa-surface px-2 py-1 text-[10px] text-oa-text-muted hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Restore
                    </button>
                  )}
                  <ChevronDown className={`h-3.5 w-3.5 text-oa-text-muted transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </div>
              </button>

              {isOpen && cp.description && (
                <div id={`cp-${cp.id}`} className="border-t border-oa-border px-2.5 pb-2.5 pt-2">
                  <p className="text-[11px] text-oa-text-secondary">{cp.description}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
