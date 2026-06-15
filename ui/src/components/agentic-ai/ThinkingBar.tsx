import { TextShimmer } from "@/components/prompt-kit/text-shimmer";

interface ThinkingBarProps {
  text?: string;
  className?: string;
  onClick?: () => void;
}

export function ThinkingBar({ text = "Deep reasoning in progress", className, onClick }: ThinkingBarProps) {
  const content = (
    <TextShimmer className="text-sm font-medium text-oa-text-secondary" spread={18}>
      {text}
    </TextShimmer>
  );

  return (
    <div className={`oa-prompt-thinking-bar ${className ?? ""}`} role="status" aria-live="polite" aria-label="Agent is thinking">
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="inline-flex items-center gap-1 text-left transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
        >
          {content}
        </button>
      ) : (
        content
      )}
    </div>
  );
}
