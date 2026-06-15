import { Check, Copy, MoreHorizontal, MessageSquareQuote, Pin, RotateCcw, SmilePlus } from "lucide-react";
import { DropdownMenu, Toolbar } from "radix-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useMessageReactions } from "../../lib/messageReactions";
import type { TimelineSide } from "./timelineModel";

interface MessageActionsProps {
  text: string;
  onRetry?: () => void;
  showRetry?: boolean;
  messageId?: string;
  pinned?: boolean;
  onTogglePin?: () => void;
  onReply?: () => void;
  side?: TimelineSide;
  onCopyLink?: () => void;
}

function ActionButton({
  label,
  children,
  onClick,
  pressed,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  pressed?: boolean;
}) {
  return (
    <Toolbar.Button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      className="oa-message-action-btn"
    >
      {children}
    </Toolbar.Button>
  );
}

export function MessageActions({
  text,
  onRetry,
  showRetry,
  messageId,
  pinned = false,
  onTogglePin,
  onReply,
  side = "left",
  onCopyLink,
}: MessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const { reactions, toggleReaction } = useMessageReactions(messageId);
  const copyTimerRef = useRef<number | null>(null);
  const liked = reactions.has("like");

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
      }, 1600);
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

  if (side === "center") return null;

  return (
    <Toolbar.Root
      data-side={side}
      className="oa-message-hover-toolbar"
      aria-label="Message actions"
    >
      <ActionButton
        label={liked ? "Remove quick reaction" : "Add quick reaction"}
        onClick={() => toggleReaction("like")}
        pressed={liked}
      >
        <SmilePlus size={16} aria-hidden="true" />
      </ActionButton>

      <ActionButton label="Reply" onClick={handleReply}>
        <MessageSquareQuote size={16} aria-hidden="true" />
      </ActionButton>

      {showRetry && onRetry && (
        <ActionButton label="Retry send" onClick={onRetry}>
          <RotateCcw size={16} aria-hidden="true" />
        </ActionButton>
      )}

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label="More message actions"
            title="More"
            className="oa-message-action-btn"
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="top"
            align={side === "right" ? "start" : "end"}
            className="oa-message-menu"
          >
            <DropdownMenu.Item className="oa-message-menu-item" onSelect={handleCopy}>
              {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
              {copied ? "Copied" : "Copy text"}
            </DropdownMenu.Item>
            <DropdownMenu.Item className="oa-message-menu-item" onSelect={onCopyLink}>
              <Copy size={15} aria-hidden="true" />
              Copy link
            </DropdownMenu.Item>
            {onTogglePin && (
              <DropdownMenu.Item className="oa-message-menu-item" onSelect={onTogglePin}>
                <Pin size={15} aria-hidden="true" className={pinned ? "rotate-45" : ""} />
                {pinned ? "Unpin message" : "Pin message"}
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Separator className="oa-message-menu-separator" />
            <DropdownMenu.Item className="oa-message-menu-item" disabled>
              Edit message
            </DropdownMenu.Item>
            <DropdownMenu.Item className="oa-message-menu-item danger" disabled>
              Delete message
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </Toolbar.Root>
  );
}
