import { useState } from "react";
import { Bot, X, GripVertical, Minus, Square } from "lucide-react";
import { OracleAvatar } from "../primitives/OracleAvatar";
import { AgentToolbar } from "./AgentToolbar";

interface AgentPanelProps {
  title?: string;
  agentId?: string;
  agentName?: string;
  children: React.ReactNode;
  onClose?: () => void;
  onMinimize?: () => void;
  actions?: Array<{ id: string; label: string; icon?: React.ReactNode; variant?: "default" | "primary" | "danger"; disabled?: boolean }>;
  onAction?: (id: string) => void;
  isRunning?: boolean;
  className?: string;
}

export function AgentPanel({
  title = "Agent",
  agentId,
  agentName,
  children,
  onClose,
  onMinimize,
  actions,
  onAction,
  isRunning,
  className,
}: AgentPanelProps) {
  return (
    <div className={`flex flex-col overflow-hidden rounded-xl border border-oa-border bg-oa-surface shadow-lg ${className ?? ""}`}>
      <div className="flex items-center justify-between border-b border-oa-border px-3 py-2.5 bg-oa-bg-elevated">
        <div className="flex items-center gap-2 min-w-0">
          <GripVertical className="h-3.5 w-3.5 shrink-0 text-oa-text-disabled cursor-grab" />
          <OracleAvatar
            seed={agentId ?? "agent"}
            initials={(agentName ?? "AG").slice(0, 2).toUpperCase()}
            size="sm"
            className="h-6 w-6 shrink-0"
          />
          <span className="text-xs font-semibold text-oa-text truncate">{agentName ?? title}</span>
          {isRunning && (
            <span className="flex h-2 w-2 shrink-0">
              <span className="absolute h-2 w-2 animate-ping rounded-full bg-oa-green opacity-75" />
              <span className="h-2 w-2 rounded-full bg-oa-green" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onMinimize && (
            <button type="button" onClick={onMinimize} className="flex h-6 w-6 items-center justify-center rounded text-oa-text-muted hover:text-oa-text hover:bg-oa-surface">
              <Minus className="h-3.5 w-3.5" />
            </button>
          )}
          {onClose && (
            <button type="button" onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded text-oa-text-muted hover:text-oa-red hover:bg-oa-red/10">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {actions && onAction && (
        <div className="border-b border-oa-border px-3 py-2">
          <AgentToolbar actions={actions} onAction={onAction} isRunning={isRunning} />
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3">
        {children}
      </div>
    </div>
  );
}
