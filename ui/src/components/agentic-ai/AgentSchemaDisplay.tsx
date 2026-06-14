import { useEffect, useRef, useState } from "react";
import { Braces, Copy, Check, ChevronDown, ChevronRight, Search, Eye, EyeOff } from "lucide-react";

interface SchemaField {
  key: string;
  value: unknown;
  type: string;
  description?: string;
  required?: boolean;
}

interface AgentSchemaDisplayProps {
  title?: string;
  schema: Record<string, unknown> | unknown[];
  fields?: SchemaField[];
  flattenDepth?: number;
  className?: string;
}

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `"${value.length > 60 ? value.slice(0, 60) + "..." : value}"`;
  if (typeof value === "object") return JSON.stringify(value).length > 80 ? `${Array.isArray(value) ? "Array" : "Object"} (${JSON.stringify(value).length} bytes)` : JSON.stringify(value);
  return String(value);
}

function getType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array[${value.length}]`;
  return typeof value;
}

export function AgentSchemaDisplay({
  title = "Payload",
  schema,
  fields,
  flattenDepth = 3,
  className,
}: AgentSchemaDisplayProps) {
  const [rawMode, setRawMode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(["root"]));
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const togglePath = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(schema, null, 2));
    setCopied(true);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      copyTimerRef.current = null;
      setCopied(false);
    }, 2000);
  };

  const fallback: SchemaField[] = Array.isArray(schema)
    ? schema.map((v, i) => ({ key: String(i), value: v, type: getType(v) }))
    : Object.entries(schema).map(([k, v]) => ({ key: k, value: v, type: getType(v) }));
  const entries: SchemaField[] = fields ?? fallback;

  return (
    <div className={`rounded-xl border border-oa-border bg-oa-surface ${className ?? ""}`}>
      <div className="flex items-center justify-between border-b border-oa-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Braces className="h-4 w-4 text-oa-purple" />
          <span className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">{title}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setRawMode(!rawMode)}
            aria-pressed={rawMode}
            className="flex min-h-[48px] items-center gap-1 rounded px-1.5 py-1 text-[10px] text-oa-text-muted hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
          >
            {rawMode ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {rawMode ? "Structured" : "Raw"}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="flex min-h-[48px] items-center gap-1 px-2 text-[10px] text-oa-text-muted hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
          >
            {copied ? <Check className="h-3 w-3 text-oa-green" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
      </div>

      <div className="max-h-80 overflow-auto p-3">
        {rawMode ? (
          <pre className="text-[11px] font-mono text-oa-text-secondary whitespace-pre-wrap break-words">
            {JSON.stringify(schema, null, 2)}
          </pre>
        ) : (
          <div className="space-y-1">
            {entries.map((entry, i) => {
              const path = `root.${entry.key}`;
              const isExpanded = expandedPaths.has(path);
              const isNested = typeof entry.value === "object" && entry.value !== null;

              return (
                <div key={entry.key} className="rounded-lg border border-oa-border bg-oa-bg-elevated">
                  <button
                    type="button"
                    onClick={() => isNested && togglePath(path)}
                    aria-expanded={isNested && isExpanded}
                    aria-controls={isNested ? `schema-${path}` : undefined}
                    className="flex min-h-[48px] w-full items-center gap-2 p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-oa-blue"
                  >
                    {isNested ? (
                      isExpanded ? <ChevronDown className="h-3 w-3 shrink-0 text-oa-text-muted" /> : <ChevronRight className="h-3 w-3 shrink-0 text-oa-text-muted" />
                    ) : <span className="w-3 shrink-0" />}
                    <span className="text-xs font-medium text-oa-text font-mono">{entry.key}</span>
                    <span className={`rounded px-1 py-0.5 text-[9px] font-medium ${
                      entry.required === false ? "bg-oa-text-disabled/10 text-oa-text-disabled" : "bg-oa-blue/10 text-oa-blue"
                    }`}>
                      {entry.type}
                    </span>
                    {entry.description && (
                      <span className="text-[10px] text-oa-text-muted truncate">{entry.description}</span>
                    )}
                    {!isNested && (
                      <span className="ml-auto text-[10px] text-oa-text-muted font-mono truncate max-w-[200px]">
                        {formatValue(entry.value)}
                      </span>
                    )}
                  </button>

                  {isNested && isExpanded && (
                    <div className="border-t border-oa-border p-2">
                      <pre className="text-[10px] font-mono text-oa-text-secondary whitespace-pre-wrap break-words max-h-40 overflow-auto">
                        {JSON.stringify(entry.value, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
