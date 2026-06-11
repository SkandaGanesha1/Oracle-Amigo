import { Play, Square, RotateCcw, SkipForward, Settings, Download, Share2, Filter } from "lucide-react";

interface ToolbarAction {
  id: string;
  label: string;
  icon?: React.ReactNode;
  variant?: "default" | "primary" | "danger";
  disabled?: boolean;
}

interface AgentToolbarProps {
  actions: ToolbarAction[];
  onAction: (id: string) => void;
  isRunning?: boolean;
  className?: string;
}

export function AgentToolbar({ actions, onAction, isRunning, className }: AgentToolbarProps) {
  const defaultActions: ToolbarAction[] = [
    { id: "run", label: "Run", icon: <Play className="h-3.5 w-3.5" />, variant: "primary" },
    { id: "stop", label: "Stop", icon: <Square className="h-3.5 w-3.5" />, variant: "danger", disabled: !isRunning },
    { id: "restart", label: "Restart", icon: <RotateCcw className="h-3.5 w-3.5" /> },
    { id: "skip", label: "Skip", icon: <SkipForward className="h-3.5 w-3.5" />, disabled: !isRunning },
  ];

  const allActions = actions.length > 0 ? actions : defaultActions;

  const variantStyles: Record<string, string> = {
    default: "border-oa-border bg-oa-surface text-oa-text-secondary hover:bg-oa-surface-2",
    primary: "border-oa-blue/30 bg-oa-blue/10 text-oa-blue hover:bg-oa-blue/20",
    danger: "border-oa-red/30 bg-oa-red/10 text-oa-red hover:bg-oa-red/20",
  };

  return (
    <div className={`flex flex-wrap items-center gap-1.5 rounded-xl border border-oa-border bg-oa-surface p-2 ${className ?? ""}`}>
      {allActions.map((action) => (
        <button
          key={action.id}
          type="button"
          disabled={action.disabled}
          onClick={() => onAction(action.id)}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${variantStyles[action.variant ?? "default"]}`}
        >
          {action.icon}
          {action.label}
        </button>
      ))}
    </div>
  );
}
