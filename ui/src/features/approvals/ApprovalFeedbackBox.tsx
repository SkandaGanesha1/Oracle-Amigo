import { useState } from "react";
import { Search, Send } from "lucide-react";

interface ApprovalFeedbackBoxProps {
  onSubmit: (feedback: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ApprovalFeedbackBox({ onSubmit, disabled, placeholder }: ApprovalFeedbackBoxProps) {
  const [text, setText] = useState("");

  function handleSubmit() {
    if (text.trim()) {
      onSubmit(text.trim());
      setText("");
    }
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder ?? "Type correction feedback to refine file search..."}
          rows={2}
          disabled={disabled}
          className="w-full resize-none rounded-lg border border-oa-border bg-oa-bg p-2.5 pr-8 text-xs text-oa-text placeholder-oa-text-disabled outline-none transition focus:border-oa-blue disabled:opacity-50"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled || !text.trim()}
          onClick={handleSubmit}
          className="inline-flex items-center gap-1.5 rounded-lg border border-oa-blue/30 bg-oa-blue/10 px-3 py-1.5 text-xs font-medium text-oa-blue transition hover:bg-oa-blue/20 disabled:opacity-50"
        >
          <Search className="h-3.5 w-3.5" />
          Search Again with Feedback
        </button>
      </div>
    </div>
  );
}
