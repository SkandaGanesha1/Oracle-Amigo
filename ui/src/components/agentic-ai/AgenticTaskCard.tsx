import { useState } from "react";
import { Target, Search, FileSearch, ShieldCheck, Upload, CheckCircle2, XCircle, Clock, ArrowRight, ChevronDown, ChevronRight, User, Bot, HardDrive } from "lucide-react";

interface TaskPhase {
  id: string;
  label: string;
  status: "pending" | "active" | "completed" | "failed" | "skipped";
  description?: string;
  details?: string;
}

interface TaskActor {
  name: string;
  type: "human" | "agent" | "system";
}

interface TaskFile {
  name: string;
  path?: string;
  role: "requested" | "candidate" | "selected" | "transferred";
}

interface AgenticTaskCardProps {
  title: string;
  description?: string;
  requester?: TaskActor;
  responder?: TaskActor;
  phases: TaskPhase[];
  files?: TaskFile[];
  result?: { status: "found" | "not_found" | "need_help"; message: string };
  className?: string;
}

const phaseIcons: Record<string, typeof Search> = {
  request: User,
  search: FileSearch,
  candidate: FileSearch,
  approval: ShieldCheck,
  transfer: Upload,
  complete: CheckCircle2,
};

const statusIcon: Record<string, typeof Clock> = {
  pending: Clock,
  active: Clock,
  completed: CheckCircle2,
  failed: XCircle,
  skipped: Clock,
};

const statusColor: Record<string, string> = {
  pending: "text-oa-text-disabled",
  active: "text-oa-blue",
  completed: "text-oa-green",
  failed: "text-oa-red",
  skipped: "text-oa-text-muted",
};

const fileRoleIcon: Record<string, typeof HardDrive> = {
  requested: Search,
  candidate: FileSearch,
  selected: ShieldCheck,
  transferred: Upload,
};

export function AgenticTaskCard({ title, description, requester, responder, phases, files, result, className }: AgenticTaskCardProps) {
  const [expanded, setExpanded] = useState(false);

  const activeIndex = phases.findIndex((p) => p.status === "active");
  const completedCount = phases.filter((p) => p.status === "completed").length;

  return (
    <div className={`rounded-xl border border-oa-border bg-oa-surface ${className ?? ""}`}>
      <div className="flex items-start justify-between gap-3 border-b border-oa-border px-4 py-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-oa-blue/10">
            <Target className="h-4 w-4 text-oa-blue" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-oa-text">{title}</h3>
            {description && <p className="mt-0.5 text-[11px] text-oa-text-muted">{description}</p>}
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {requester && (
                <span className="flex items-center gap-1 text-[10px] text-oa-text-muted">
                  <User className="h-3 w-3" />
                  {requester.name}
                </span>
              )}
              {requester && responder && <ArrowRight className="h-3 w-3 text-oa-text-disabled" />}
              {responder && (
                <span className="flex items-center gap-1 text-[10px] text-oa-text-muted">
                  <Bot className="h-3 w-3" />
                  {responder.name}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="rounded-full bg-oa-surface-2 px-2 py-0.5 text-[10px] text-oa-text-muted">
            {completedCount}/{phases.length}
          </span>
        </div>
      </div>

      <div className="space-y-1 p-3">
        {phases.map((phase, index) => {
          const PhaseIcon = phaseIcons[phase.id] ?? Clock;
          const StatIcon = statusIcon[phase.status] ?? Clock;
          const color = statusColor[phase.status] ?? "text-oa-text-muted";
          const isLast = index === phases.length - 1;

          return (
            <div key={phase.id} className="relative flex gap-3">
              {!isLast && (
                <div className={`absolute left-[13px] top-6 h-full w-px ${phase.status === "completed" ? "bg-oa-green/30" : "bg-oa-border"}`} />
              )}
              <div className="relative z-10 mt-1">
                <StatIcon className={`h-[18px] w-[18px] ${color} ${phase.status === "active" ? "animate-spin" : ""}`} />
              </div>
              <div className="min-w-0 flex-1 pb-3">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium ${phase.status === "pending" ? "text-oa-text-disabled" : "text-oa-text"}`}>
                    {phase.label}
                  </span>
                  {phase.description && (
                    <span className="text-[10px] text-oa-text-muted">{phase.description}</span>
                  )}
                </div>
                {phase.details && (
                  <p className="mt-0.5 text-[10px] text-oa-text-muted leading-relaxed">{phase.details}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {files && files.length > 0 && (
        <div className="border-t border-oa-border/50 px-4 py-2">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            className="flex min-h-[48px] w-full items-center gap-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-oa-blue"
          >
            {expanded ? <ChevronDown className="h-3 w-3 text-oa-text-muted" /> : <ChevronRight className="h-3 w-3 text-oa-text-muted" />}
            <span className="text-[10px] font-medium text-oa-text-muted uppercase tracking-wider">Files ({files.length})</span>
          </button>
          {expanded && (
            <div className="mt-1 space-y-1">
              {files.map((f) => {
                const FileIcon = fileRoleIcon[f.role] ?? HardDrive;
                return (
                  <div key={f.name} className="flex items-center gap-2 rounded-md bg-oa-bg-elevated px-2 py-1.5">
                    <FileIcon className="h-3 w-3 shrink-0 text-oa-text-muted" />
                    <span className="text-[10px] font-mono text-oa-text truncate">{f.name}</span>
                    {f.path && <span className="text-[9px] text-oa-text-muted truncate">{f.path}</span>}
                    <span className="ml-auto rounded bg-oa-surface-2 px-1 py-0.5 text-[8px] text-oa-text-muted uppercase">{f.role}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="flex items-center gap-2 border-t border-oa-border px-4 py-2.5">
          {result.status === "found" && <CheckCircle2 className="h-4 w-4 text-oa-green" />}
          {result.status === "not_found" && <XCircle className="h-4 w-4 text-oa-red" />}
          {result.status === "need_help" && <Clock className="h-4 w-4 text-oa-amber" />}
          <span className="text-xs text-oa-text-secondary">{result.message}</span>
          <span className={`ml-auto rounded px-1.5 py-0.5 text-[9px] font-medium uppercase ${
            result.status === "found" ? "bg-oa-green/20 text-oa-green"
            : result.status === "not_found" ? "bg-oa-red/20 text-oa-red"
            : "bg-oa-amber/20 text-oa-amber"
          }`}>
            {result.status.replace(/_/g, " ")}
          </span>
        </div>
      )}
    </div>
  );
}
