import { Brain } from "lucide-react";
import { ThinkingBar } from "../agentic-ai/ThinkingBar";

interface TypingIndicatorProps {
  label?: string;
  phase?: "thinking" | "searching" | "executing" | null;
  reasoningText?: string;
  onStop?: () => void;
}

const phaseLabels: Record<string, { label: string; text: string }> = {
  thinking: { label: "Agent is thinking", text: "Thinking through your request..." },
  searching: { label: "Agent is searching", text: "Searching for information..." },
  executing: { label: "Agent is working", text: "Processing..." },
};

export function TypingIndicator({ label, phase, reasoningText, onStop }: TypingIndicatorProps) {
  if (phase && phaseLabels[phase]) {
    const config = phaseLabels[phase];
    return (
      <ThinkingBar
        text={reasoningText ?? config.text}
        showStop={Boolean(onStop)}
        onStop={onStop}
        className="mx-4 mb-2"
      />
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3" aria-label={label ?? "Agent is typing"} role="status">
      <div className="flex items-center gap-3 rounded-2xl bg-oa-bubble-bg px-4 py-2.5 ring-1 ring-oa-border">
        <Brain className="h-3.5 w-3.5 text-oa-blue" />
        <div className="flex gap-1">
          <span className="h-2 w-2 animate-bounce rounded-full bg-oa-text-muted" style={{ animationDelay: "0ms" }} />
          <span className="h-2 w-2 animate-bounce rounded-full bg-oa-text-muted" style={{ animationDelay: "150ms" }} />
          <span className="h-2 w-2 animate-bounce rounded-full bg-oa-text-muted" style={{ animationDelay: "300ms" }} />
        </div>
        <span className="text-xs text-oa-text-muted">{label ?? "Agent is typing"}</span>
      </div>
    </div>
  );
}
