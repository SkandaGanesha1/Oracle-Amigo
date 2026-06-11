import { Lightbulb, ArrowRight, X } from "lucide-react";

interface Suggestion {
  id: string;
  text: string;
  description?: string;
  icon?: React.ReactNode;
}

interface AgentSuggestionProps {
  suggestions: Suggestion[];
  onSelect: (id: string) => void;
  onDismiss?: (id: string) => void;
  title?: string;
  className?: string;
}

export function AgentSuggestion({ suggestions, onSelect, onDismiss, title = "Suggestions", className }: AgentSuggestionProps) {
  if (suggestions.length === 0) return null;

  return (
    <div className={`rounded-xl border border-oa-border bg-oa-surface ${className ?? ""}`}>
      <div className="flex items-center gap-2 border-b border-oa-border px-4 py-2.5">
        <Lightbulb className="h-4 w-4 text-oa-amber" />
        <span className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">{title}</span>
      </div>

      <div className="space-y-1 p-2">
        {suggestions.map((suggestion) => (
          <div
            key={suggestion.id}
            className="group flex items-start gap-2.5 rounded-lg border border-oa-border bg-oa-bg-elevated p-2.5 transition hover:border-oa-blue/30"
          >
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-oa-amber/10">
              {suggestion.icon ?? <Lightbulb className="h-3.5 w-3.5 text-oa-amber" />}
            </div>
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onSelect(suggestion.id)}
                className="text-left text-xs font-medium text-oa-text hover:text-oa-blue transition-colors"
              >
                {suggestion.text}
              </button>
              {suggestion.description && (
                <p className="mt-0.5 text-[10px] text-oa-text-muted">{suggestion.description}</p>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={() => onSelect(suggestion.id)}
                className="flex h-6 w-6 items-center justify-center rounded text-oa-text-muted hover:text-oa-blue hover:bg-oa-surface"
              >
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
              {onDismiss && (
                <button
                  type="button"
                  onClick={() => onDismiss(suggestion.id)}
                  className="flex h-6 w-6 items-center justify-center rounded text-oa-text-muted hover:text-oa-red hover:bg-oa-surface"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
