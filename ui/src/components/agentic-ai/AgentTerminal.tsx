import { useEffect, useRef, useState } from "react";
import { Terminal, Copy, Check, RotateCcw } from "lucide-react";

interface TerminalLine {
  text: string;
  type: "input" | "output" | "error" | "system";
  timestamp?: string;
}

interface AgentTerminalProps {
  lines: TerminalLine[];
  onCommand?: (command: string) => void;
  title?: string;
  maxHeight?: string;
  className?: string;
}

export function AgentTerminal({ lines, onCommand, title = "Terminal", maxHeight = "300px", className }: AgentTerminalProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopyAll = async () => {
    const text = lines.map((l) => l.text).join("\n");
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && onCommand) {
      onCommand(input.trim());
      setInput("");
    }
  };

  const typeStyles: Record<string, string> = {
    input: "text-oa-green",
    output: "text-oa-text-secondary",
    error: "text-oa-red",
    system: "text-oa-cyan",
  };

  const typePrefix: Record<string, string> = {
    input: "$",
    output: "",
    error: "✗",
    system: "→",
  };

  return (
    <div className={`overflow-hidden rounded-xl border border-oa-border bg-oa-bg ${className ?? ""}`}>
      <div className="flex items-center justify-between border-b border-oa-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-oa-green" />
          <span className="text-xs font-medium text-oa-text-muted">{title}</span>
        </div>
        <button
          type="button"
          onClick={handleCopyAll}
          className="flex items-center gap-1 text-[10px] text-oa-text-muted hover:text-oa-text"
        >
          {copied ? <Check className="h-3 w-3 text-oa-green" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <div ref={scrollRef} className="overflow-auto p-3 font-mono" style={{ maxHeight }}>
        <div className="space-y-0.5">
          {lines.map((line, i) => (
            <div key={i} className={`flex items-start gap-2 text-xs leading-5 ${typeStyles[line.type]}`}>
              {typePrefix[line.type] && (
                <span className="shrink-0 text-oa-text-muted select-none">{typePrefix[line.type]}</span>
              )}
              <span className="whitespace-pre-wrap break-words">{line.text}</span>
            </div>
          ))}
        </div>
      </div>

      {onCommand && (
        <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-oa-border px-3 py-2">
          <span className="text-xs text-oa-green select-none">$</span>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a command..."
            className="min-w-0 flex-1 bg-transparent text-xs text-oa-text outline-none placeholder-oa-text-disabled font-mono"
          />
        </form>
      )}
    </div>
  );
}
