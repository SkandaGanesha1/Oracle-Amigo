import { Sparkles } from "lucide-react";
import type { SuggestedPrompt } from "../../types";

interface SuggestedPromptsProps {
  prompts: SuggestedPrompt[];
  onSelect: (text: string) => void;
}

export function SuggestedPrompts({ prompts, onSelect }: SuggestedPromptsProps) {
  if (prompts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 px-1" aria-label="Suggested prompts">
      {prompts.map((prompt) => (
        <button
          key={`${prompt.category}-${prompt.text}`}
          type="button"
          onClick={() => onSelect(prompt.text)}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-oa-border bg-oa-surface/80 px-3 py-1 text-[11px] text-oa-text-muted transition-colors hover:border-oa-blue/40 hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
        >
          <Sparkles className="h-3 w-3 text-oa-blue" aria-hidden="true" />
          {prompt.text}
        </button>
      ))}
    </div>
  );
}
