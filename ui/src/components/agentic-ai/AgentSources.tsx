import { useState } from "react";
import { Link2, ExternalLink, FileText, ChevronDown, Search } from "lucide-react";

interface Source {
  id: string;
  title: string;
  url?: string;
  snippet?: string;
  relevance?: number;
  sourceType?: "file" | "web" | "memory" | "tool";
}

interface AgentSourcesProps {
  sources: Source[];
  className?: string;
}

const typeIcons: Record<string, typeof FileText> = {
  file: FileText,
  web: Link2,
  memory: Search,
  tool: Search,
};

export function AgentSources({ sources, className }: AgentSourcesProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (sources.length === 0) return null;

  const toggleExpand = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className={`rounded-xl border border-oa-border bg-oa-surface ${className ?? ""}`}>
      <div className="flex items-center gap-2 border-b border-oa-border px-4 py-2.5">
        <Link2 className="h-4 w-4 text-oa-cyan" />
        <span className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">Sources</span>
        <span className="ml-auto rounded-full bg-oa-surface-2 px-1.5 py-0.5 text-[10px] text-oa-text-muted">{sources.length}</span>
      </div>

      <div className="space-y-1 p-2">
        {sources.map((source) => {
          const isOpen = expanded[source.id] ?? false;
          const TypeIcon = typeIcons[source.sourceType ?? "file"] ?? FileText;

          return (
            <div key={source.id} className="rounded-lg border border-oa-border bg-oa-bg-elevated">
              <button
                type="button"
                onClick={() => toggleExpand(source.id)}
                aria-expanded={isOpen}
                aria-controls={`src-${source.id}`}
                className="flex min-h-[48px] w-full items-center justify-between gap-2 p-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-oa-blue"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <TypeIcon className="h-3.5 w-3.5 shrink-0 text-oa-text-muted" />
                  <span className="text-xs font-medium text-oa-text truncate">{source.title}</span>
                  {source.relevance !== undefined && (
                    <span className="shrink-0 rounded bg-oa-blue/10 px-1.5 py-0.5 text-[10px] text-oa-blue">
                      {Math.round(source.relevance * 100)}%
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {source.url && (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex min-h-[48px] min-w-[48px] items-center justify-center text-oa-text-muted hover:text-oa-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
                      aria-label={`Open ${source.title}`}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  <ChevronDown className={`h-3.5 w-3.5 text-oa-text-muted transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </div>
              </button>

              {isOpen && source.snippet && (
                <div id={`src-${source.id}`} className="border-t border-oa-border px-2.5 pb-2.5 pt-2">
                  <p className="text-[11px] text-oa-text-muted leading-relaxed">{source.snippet}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
