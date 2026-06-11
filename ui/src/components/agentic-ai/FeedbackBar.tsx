import { useState } from "react";
import { ThumbsUp, ThumbsDown, Send, MessageSquare } from "lucide-react";

interface FeedbackBarProps {
  onFeedback?: (type: "positive" | "negative", comment?: string) => void;
  className?: string;
}

export function FeedbackBar({ onFeedback, className }: FeedbackBarProps) {
  const [selected, setSelected] = useState<"positive" | "negative" | null>(null);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    if (selected && onFeedback) onFeedback(selected, comment.trim() || undefined);
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className={`flex items-center gap-2 rounded-lg border border-oa-green/20 bg-oa-green/5 px-3 py-2 ${className ?? ""}`}>
        <ThumbsUp className="h-3.5 w-3.5 text-oa-green" />
        <span className="text-[11px] text-oa-text-muted">Thanks for your feedback!</span>
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-oa-text-muted">Was this helpful?</span>
        <button
          type="button"
          onClick={() => setSelected("positive")}
          aria-pressed={selected === "positive"}
          className={`flex min-h-[48px] min-w-[48px] items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2 ${
            selected === "positive"
              ? "bg-oa-green/10 text-oa-green"
              : "text-oa-text-muted hover:text-oa-text hover:bg-oa-surface"
          }`}
          aria-label="Helpful"
        >
          <ThumbsUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setSelected("negative")}
          aria-pressed={selected === "negative"}
          className={`flex min-h-[48px] min-w-[48px] items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2 ${
            selected === "negative"
              ? "bg-oa-red/10 text-oa-red"
              : "text-oa-text-muted hover:text-oa-text hover:bg-oa-surface"
          }`}
          aria-label="Not helpful"
        >
          <ThumbsDown className="h-3.5 w-3.5" />
        </button>

        {selected && (
          <button
            type="button"
            onClick={handleSubmit}
            className="flex min-h-[48px] items-center gap-1 rounded-md bg-oa-blue px-2.5 py-1.5 text-[10px] font-medium text-white hover:bg-oa-blue/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2 ml-auto"
          >
            <Send className="h-3 w-3" />
            Submit
          </button>
        )}
      </div>

      {selected === "negative" && (
        <div className="flex items-start gap-2">
          <MessageSquare className="mt-1.5 h-3 w-3 shrink-0 text-oa-text-muted" />
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What could be improved?"
            rows={2}
            className="w-full resize-none rounded-md border border-oa-border bg-oa-bg p-2 text-[10px] text-oa-text placeholder-oa-text-disabled outline-none transition focus:border-oa-blue"
          />
        </div>
      )}
    </div>
  );
}
