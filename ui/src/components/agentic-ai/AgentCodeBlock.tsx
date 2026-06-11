import { useState } from "react";
import { Copy, Check, ChevronDown, ChevronRight, Terminal } from "lucide-react";

interface AgentCodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  showLineNumbers?: boolean;
  maxHeight?: string;
  className?: string;
}

export function AgentCodeBlock({
  code,
  language = "text",
  filename,
  showLineNumbers = true,
  maxHeight = "400px",
  className,
}: AgentCodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = code.split("\n");

  return (
    <div className={`overflow-hidden rounded-xl border border-oa-border bg-oa-bg ${className ?? ""}`}>
      <div className="flex items-center justify-between border-b border-oa-border px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-expanded={!collapsed}
            aria-controls="code-block-content"
            className="flex min-h-[48px] min-w-[48px] items-center justify-center text-oa-text-muted hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          <Terminal className="h-3.5 w-3.5 shrink-0 text-oa-text-muted" />
          {filename && <span className="text-xs font-medium text-oa-text truncate">{filename}</span>}
          <span className="text-[10px] text-oa-text-muted uppercase">{language}</span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="flex min-h-[48px] items-center gap-1 px-2 text-[10px] text-oa-text-muted hover:text-oa-text shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
        >
          {copied ? <Check className="h-3 w-3 text-oa-green" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {!collapsed && (
        <div id="code-block-content" className="overflow-auto" style={{ maxHeight }}>
          <table className="w-full border-collapse">
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} className="group">
                  {showLineNumbers && (
                    <td className="select-none border-r border-oa-border px-3 text-right text-[10px] leading-5 text-oa-text-disabled align-top w-10">
                      {i + 1}
                    </td>
                  )}
                  <td className="px-3 py-0">
                    <pre className="text-[12px] leading-5 font-mono text-oa-text-secondary whitespace-pre-wrap break-words">
                      {line || " "}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
