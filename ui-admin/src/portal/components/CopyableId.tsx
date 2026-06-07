import { Check, Copy } from "lucide-react";
import { useState, type FC } from "react";

interface CopyableIdProps {
  value: string | number | null | undefined;
  prefix?: number;
  className?: string;
  monospace?: boolean;
}

export const CopyableId: FC<CopyableIdProps> = ({ value, prefix = 8, className, monospace = true }) => {
  const [copied, setCopied] = useState(false);
  if (value === null || value === undefined || value === "") {
    return <span className="text-white/35">—</span>;
  }
  const raw = String(value);
  const display = raw.length > prefix ? `${raw.slice(0, prefix)}…` : raw;
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore clipboard failures
    }
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      title={raw}
      className={`group inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-white/65 transition hover:bg-white/10 hover:text-white ${
        monospace ? "font-mono" : ""
      } ${className ?? ""}`}
    >
      {display}
      {copied ? <Check className="h-3 w-3 text-emerald-300" /> : <Copy className="h-3 w-3 opacity-0 transition group-hover:opacity-60" />}
    </button>
  );
};
