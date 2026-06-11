import { useState, useEffect, useSyncExternalStore } from "react";
import { Eye, EyeOff } from "lucide-react";
import { subscribePrivacyMode, getPrivacyModeSnapshot, getPrivacyModeServerSnapshot } from "../../lib/usePrivacyMode";

interface RevealableTextProps {
  text: string;
  className?: string;
}

export function RevealableText({ text, className = "" }: RevealableTextProps) {
  const [revealed, setRevealed] = useState(false);
  const privacyModeSnapshot = useSyncExternalStore(subscribePrivacyMode, getPrivacyModeSnapshot, getPrivacyModeServerSnapshot);
  const privacyMode = privacyModeSnapshot === "true";

  useEffect(() => {
    if (!privacyMode) setRevealed(false);
  }, [privacyMode]);

  if (!privacyMode) {
    return <span className={className}>{text}</span>;
  }

  const displayText = revealed
    ? text
    : text.length <= 3
      ? "***"
      : text.slice(0, 1) + "*".repeat(Math.min(text.length - 2, 12)) + text.slice(-1);

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span>{displayText}</span>
      <button
        type="button"
        onClick={() => setRevealed((r) => !r)}
        className="inline-flex items-center justify-center text-oa-text-muted hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue rounded"
        aria-label={revealed ? "Hide filename" : "Show filename"}
        title={revealed ? "Hide filename" : "Show filename"}
      >
        {revealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
      </button>
    </span>
  );
}