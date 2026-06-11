import { useState, useEffect } from "react";
import { Brain, StopCircle, Loader2 } from "lucide-react";

interface ThinkingBarProps {
  text?: string;
  confidence?: number;
  showStop?: boolean;
  onStop?: () => void;
  className?: string;
}

const reasoningMessages = [
  "Analyzing your request...",
  "Searching for information...",
  "Processing...",
  "Reviewing results...",
  "Formulating response...",
  "Checking sources...",
];

export function ThinkingBar({ text, confidence, showStop = true, onStop, className }: ThinkingBarProps) {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    if (text) return;
    const id = setInterval(() => {
      setMessageIndex((i) => (i + 1) % reasoningMessages.length);
    }, 3000);
    return () => clearInterval(id);
  }, [text]);

  const displayText = text ?? reasoningMessages[messageIndex];

  return (
    <div className={`flex items-center gap-3 rounded-xl border border-oa-blue/20 bg-oa-blue/5 px-4 py-3 ${className ?? ""}`} role="status" aria-live="polite" aria-label="Agent is thinking">
      <div className="relative flex h-8 w-8 shrink-0 items-center justify-center">
        <div className="absolute h-8 w-8 animate-ping rounded-full bg-oa-blue/20" />
        <Brain className="h-4 w-4 text-oa-blue" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-oa-text-secondary">{displayText}</span>
          <span className="flex gap-0.5">
            <span className="h-1 w-1 animate-bounce rounded-full bg-oa-blue" style={{ animationDelay: "0ms" }} />
            <span className="h-1 w-1 animate-bounce rounded-full bg-oa-blue" style={{ animationDelay: "150ms" }} />
            <span className="h-1 w-1 animate-bounce rounded-full bg-oa-blue" style={{ animationDelay: "300ms" }} />
          </span>
        </div>
        {confidence !== undefined && (
          <div className="flex items-center gap-1.5">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-oa-surface-2">
              <div
                className="h-full rounded-full bg-gradient-to-r from-oa-blue to-oa-purple transition-all duration-500"
                style={{ width: `${Math.round(confidence * 100)}%` }}
              />
            </div>
            <span className="text-[9px] text-oa-text-muted">{Math.round(confidence * 100)}%</span>
          </div>
        )}
      </div>

      {showStop && onStop && (
        <button
          type="button"
          onClick={onStop}
          className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-md text-oa-text-muted hover:text-oa-red transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
          aria-label="Stop thinking"
          title="Stop"
        >
          <StopCircle className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
