import { useEffect, useRef, useState } from "react";
import { Wrench, ChevronDown, ChevronRight, CheckCircle2, Clock, XCircle, ArrowRight, Copy, Check } from "lucide-react";

interface ToolParam {
  name: string;
  value: unknown;
  type?: string;
}

interface ToolResult {
  status: "success" | "error" | "running";
  output?: string;
  error?: string;
  durationMs?: number;
}

interface AgenticToolCallProps {
  toolName: string;
  description?: string;
  params: ToolParam[];
  result?: ToolResult;
  className?: string;
}

function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return v.length > 80 ? v.slice(0, 80) + "..." : v;
  if (typeof v === "object") return JSON.stringify(v).length > 80 ? JSON.stringify(v).slice(0, 80) + "..." : JSON.stringify(v);
  return String(v);
}

export function AgenticToolCall({ toolName, description, params, result, className }: AgenticToolCallProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    const text = JSON.stringify({ tool: toolName, params, result }, null, 2);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      copyTimerRef.current = null;
      setCopied(false);
    }, 2000);
  };

  const ResultIcon = result?.status === "success"
    ? CheckCircle2
    : result?.status === "error"
      ? XCircle
      : Clock;

  const resultColor = result?.status === "success"
    ? "text-oa-green"
    : result?.status === "error"
      ? "text-oa-red"
      : "text-oa-amber";

  const running = result?.status === "running" || !result;

  return (
    <div className={`rounded-xl border border-oa-border bg-oa-surface ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex min-h-[48px] w-full items-center justify-between gap-2 px-4 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-oa-blue"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Wrench className={`h-4 w-4 shrink-0 ${running ? "text-oa-blue" : "text-oa-text-muted"}`} />
          <div className="min-w-0">
            <span className="text-xs font-medium text-oa-text">{toolName}</span>
            {description && <p className="text-[10px] text-oa-text-muted truncate">{description}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {result && (
            <span className={`flex items-center gap-1 text-[10px] ${resultColor}`}>
              <ResultIcon className={`h-3 w-3 ${result?.status === "running" ? "animate-spin" : ""}`} />
              {result.durationMs !== undefined && result.durationMs >= 0
                ? result.durationMs >= 1000
                  ? `${(result.durationMs / 1000).toFixed(1)}s`
                  : `${result.durationMs}ms`
                : null}
            </span>
          )}
          {expanded ? <ChevronDown className="h-3.5 w-3.5 text-oa-text-muted" /> : <ChevronRight className="h-3.5 w-3.5 text-oa-text-muted" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-oa-border">
          {params.length > 0 && (
            <div className="space-y-1 px-4 py-2.5">
              <span className="text-[10px] font-medium text-oa-text-muted uppercase tracking-wider">Parameters</span>
              {params.map((p) => (
                <div key={p.name} className="flex items-start gap-2 rounded-md bg-oa-bg-elevated px-2 py-1.5">
                  <span className="shrink-0 text-[10px] font-medium text-oa-text font-mono">{p.name}</span>
                  {p.type && <span className="shrink-0 rounded bg-oa-surface-2 px-1 py-0.5 text-[8px] text-oa-text-muted">{p.type}</span>}
                  <span className="ml-auto text-[10px] text-oa-text-muted font-mono text-right truncate max-w-[200px]">{formatValue(p.value)}</span>
                </div>
              ))}
            </div>
          )}

          {result && (
            <div className="border-t border-oa-border/50 px-4 py-2.5">
              <div className="flex items-center gap-2 mb-1.5">
                <ResultIcon className={`h-3.5 w-3.5 ${resultColor}`} />
                <span className={`text-[10px] font-medium ${resultColor} uppercase`}>
                  {result.status === "success" ? "Success" : result.status === "error" ? "Error" : "Running"}
                </span>
                <ArrowRight className="h-3 w-3 text-oa-text-muted" />
                <span className="text-[10px] text-oa-text-muted">
                  {result.durationMs !== undefined && result.durationMs >= 0
                    ? result.durationMs >= 1000
                      ? `${(result.durationMs / 1000).toFixed(1)}s`
                      : `${result.durationMs}ms`
                    : null}
                </span>
              </div>
              {(result.output || result.error) && (
                <pre className={`overflow-auto whitespace-pre-wrap break-words rounded border p-2 text-[10px] font-mono max-h-36 ${
                  result.status === "error" ? "border-oa-red/20 bg-oa-red/5 text-oa-red" : "border-oa-border bg-oa-bg text-oa-text-secondary"
                }`}>
                  {result.output ?? result.error}
                </pre>
              )}
            </div>
          )}

          <div className="flex justify-end border-t border-oa-border/50 px-4 py-1.5">
            <button
              type="button"
              onClick={handleCopy}
              className="flex min-h-[48px] items-center gap-1 text-[9px] text-oa-text-muted hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
            >
              {copied ? <Check className="h-3 w-3 text-oa-green" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy call"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
