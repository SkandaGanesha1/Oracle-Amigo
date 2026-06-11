import { useState, type FC } from "react";

export const FeedbackBox: FC<{
  onFeedback: (feedback: string) => void;
  disabled?: boolean;
}> = ({ onFeedback, disabled }) => {
  const [text, setText] = useState("");

  const handleSubmit = () => {
    if (text.trim()) {
      onFeedback(text.trim());
      setText("");
    }
  };

  return (
    <div className="mt-3 space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type correction feedback to refine file search..."
        rows={2}
        disabled={disabled}
        className="w-full resize-none rounded border border-white/10 bg-black/25 p-2 text-xs text-white placeholder-white/30 outline-none transition focus:border-white/20 disabled:opacity-50"
      />
      <button
        type="button"
        disabled={disabled || !text.trim()}
        onClick={handleSubmit}
        className="rounded bg-amber-500/80 px-3 py-1.5 text-xs font-medium text-black transition hover:bg-amber-400 disabled:opacity-50"
      >
        Search Again with Feedback
      </button>
    </div>
  );
};
