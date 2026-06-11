import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Bot, Loader2, Radio } from "lucide-react";
import { AgentRunCard } from "./AgentRunCard";
import { useAgentRun } from "../../hooks/queries";
import { useAgentRunEvents } from "./useAgentRunEvents";
import type { A2ATaskMessage } from "../../api/types";

interface AgentRunMessageProps {
  message: A2ATaskMessage;
}

export function AgentRunMessage({ message }: AgentRunMessageProps) {
  const queryClient = useQueryClient();
  const { data: run, isLoading } = useAgentRun(message.task_id);
  const { connected } = useAgentRunEvents({ runId: message.task_id, enabled: run?.status === "running" });

  const handleStop = useCallback(() => {
    queryClient.cancelQueries({ queryKey: ["agent", "runs", message.task_id] });
  }, [queryClient, message.task_id]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-oa-border bg-oa-surface px-3 py-2">
        <Loader2 className="h-4 w-4 animate-spin text-oa-blue" />
        <span className="text-sm text-oa-text-secondary">Loading agent run...</span>
      </div>
    );
  }

  if (run) {
    return (
      <div className="relative">
        {connected && (
          <div className="mb-2 flex items-center gap-1.5 text-[10px] text-oa-green">
            <Radio className="h-3 w-3 animate-pulse" />
            Live updates
          </div>
        )}
        <AgentRunCard run={run} onStop={handleStop} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-oa-border bg-oa-surface px-3 py-2">
      <Bot className="h-4 w-4 text-oa-text-muted" />
      <span className="text-sm text-oa-text-secondary">Agent task ({message.internal_state})</span>
    </div>
  );
}
