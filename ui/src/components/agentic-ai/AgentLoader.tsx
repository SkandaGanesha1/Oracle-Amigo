import { Brain, Search, Loader2, AlertCircle, Wrench } from "lucide-react";

type AgentLoaderState = "idle" | "fetching" | "reasoning" | "tool_running" | "error";

interface AgentLoaderProps {
  state: AgentLoaderState;
  label?: string;
  errorMessage?: string;
  className?: string;
}

const stateConfig: Record<AgentLoaderState, { icon: typeof Brain; label: string; color: string; animate?: boolean }> = {
  idle: { icon: Brain, label: "Awaiting input", color: "text-oa-text-muted" },
  fetching: { icon: Search, label: "Fetching information", color: "text-oa-blue", animate: true },
  reasoning: { icon: Brain, label: "Reasoning", color: "text-oa-purple", animate: true },
  tool_running: { icon: Wrench, label: "Running tool", color: "text-oa-cyan", animate: true },
  error: { icon: AlertCircle, label: "Error", color: "text-oa-red" },
};

export function AgentLoader({ state, label, errorMessage, className }: AgentLoaderProps) {
  const config = stateConfig[state];
  const Icon = config.icon;

  if (state === "idle") return null;

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${className ?? ""} ${
        state === "error"
          ? "border-oa-red/20 bg-oa-red/5"
          : "border-oa-border bg-oa-surface"
      }`}
      role="status"
      aria-live="polite"
      aria-label={label ?? config.label}
    >
      <div className={`relative flex h-8 w-8 shrink-0 items-center justify-center ${config.color}`}>
        {config.animate && (
          <div className="absolute h-8 w-8 animate-ping rounded-full bg-current opacity-20" />
        )}
        <Icon className={`h-4 w-4 ${config.animate ? "relative" : ""} ${state === "tool_running" ? "animate-spin" : ""}`} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xs font-medium text-oa-text-secondary">
          {label ?? config.label}
        </span>
        {state === "reasoning" && (
          <span className="flex gap-0.5">
            <span className="h-1 w-1 animate-bounce rounded-full bg-oa-purple" style={{ animationDelay: "0ms" }} />
            <span className="h-1 w-1 animate-bounce rounded-full bg-oa-purple" style={{ animationDelay: "150ms" }} />
            <span className="h-1 w-1 animate-bounce rounded-full bg-oa-purple" style={{ animationDelay: "300ms" }} />
          </span>
        )}
        {state === "error" && errorMessage && (
          <span className="text-[10px] text-oa-red">{errorMessage}</span>
        )}
      </div>
    </div>
  );
}
