import { Check, Copy, Heart, Laugh, MessageSquareQuote, Pin, RotateCcw, Sparkles, ThumbsUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMessageReactions } from "../../lib/messageReactions";

interface MessageActionsProps {
  text: string;
  onRetry?: () => void;
  showRetry?: boolean;
  messageId?: string;
  pinned?: boolean;
  onTogglePin?: () => void;
  onReply?: () => void;
}

const REACTIONS = [
  { id: "like", icon: ThumbsUp, label: "Like" },
  { id: "love", icon: Heart, label: "Love" },
  { id: "smile", icon: Laugh, label: "Smile" },
  { id: "celebrate", icon: Sparkles, label: "Celebrate" },
];

export function MessageActions({
  text,
  onRetry,
  showRetry,
  messageId,
  pinned = false,
  onTogglePin,
  onReply,
}: MessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const { reactions, toggleReaction } = useMessageReactions(messageId);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        copyTimerRef.current = null;
        setCopied(false);
      }, 2000);
    } catch {
      // Clipboard can be unavailable in restricted browser contexts.
    }
  }, [text]);

  const handleReply = useCallback(() => {
    if (onReply) {
      onReply();
      return;
    }
    window.dispatchEvent(new CustomEvent("oa-reply-to-message", {
      detail: { messageId, text },
    }));
  }, [messageId, onReply, text]);

  return (
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100" role="group" aria-label="Message actions">
      <div className="flex items-center gap-0.5">
        {REACTIONS.map(({ id, icon: Icon, label }) => {
          const isActive = reactions.has(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => toggleReaction(id)}
              className={`flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2 ${
                isActive ? "bg-oa-blue/10 text-oa-blue" : "text-oa-text-muted hover:bg-oa-surface hover:text-oa-text"
              }`}
              aria-label={isActive ? `Remove ${label} reaction` : `React with ${label}`}
              aria-pressed={isActive}
              title={label}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          );
        })}
      </div>

      <div className="mx-0.5 h-4 w-px bg-oa-border/50" />

      <button
        type="button"
        onClick={handleReply}
        className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg text-oa-text-muted transition-colors hover:bg-oa-surface hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
        aria-label="Reply to message"
        title="Reply"
      >
        <MessageSquareQuote className="h-3.5 w-3.5" />
      </button>

      <button
        type="button"
        onClick={onTogglePin}
        disabled={!onTogglePin}
        className={`flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2 disabled:opacity-40 ${
          pinned ? "bg-oa-amber/10 text-oa-amber" : "text-oa-text-muted hover:bg-oa-surface hover:text-oa-text"
        }`}
        aria-label={pinned ? "Unpin message" : "Pin message"}
        aria-pressed={pinned}
        title={pinned ? "Unpin" : "Pin"}
      >
        <Pin className={`h-3.5 w-3.5 ${pinned ? "rotate-45" : ""}`} />
      </button>

      <div className="mx-0.5 h-4 w-px bg-oa-border/50" />

      <button
        type="button"
        onClick={handleCopy}
        className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg text-oa-text-muted transition-colors hover:bg-oa-surface hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
        aria-label={copied ? "Copied" : "Copy message"}
        title={copied ? "Copied" : "Copy message"}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-oa-green" /> : <Copy className="h-3.5 w-3.5" />}
      </button>

      {showRetry && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg text-oa-text-muted transition-colors hover:bg-oa-surface hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
          aria-label="Retry message"
          title="Retry"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
