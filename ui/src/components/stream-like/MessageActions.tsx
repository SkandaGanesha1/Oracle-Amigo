import EmojiPicker, { Theme } from "emoji-picker-react";
import { Check, Copy, MoreHorizontal, MessageSquareQuote, Pin, RotateCcw, SmilePlus } from "lucide-react";
import { DropdownMenu, Popover, Toolbar } from "radix-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useToggleMessageReaction } from "../../hooks/queries";
import { useMessageReactions } from "../../lib/messageReactions";
import type { TimelineSide } from "./timelineModel";

interface MessageActionsProps {
  text: string;
  onRetry?: () => void;
  showRetry?: boolean;
  messageId?: string;
  conversationId?: string;
  pinned?: boolean;
  onTogglePin?: () => void;
  onReply?: () => void;
  side?: TimelineSide;
  onCopyLink?: () => void;
}

export const QUICK_REACTIONS = [
  { emoji: "👍", unified: "1f44d", label: "Thumbs up" },
  { emoji: "❤️", unified: "2764-fe0f", label: "Heart" },
  { emoji: "😀", unified: "1f600", label: "Smile" },
  { emoji: "😢", unified: "1f622", label: "Sad" },
  { emoji: "🙏", unified: "1f64f", label: "Pray" },
  { emoji: "👎", unified: "1f44e", label: "Thumbs down" },
  { emoji: "😡", unified: "1f621", label: "Angry" }
];

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
  conversationId,
  pinned = false,
  onTogglePin,
  onReply,
  side = "left",
  onCopyLink,
}: MessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const { reactions, setReaction } = useMessageReactions(messageId);
  const persistReaction = useToggleMessageReaction(conversationId);
  const copyTimerRef = useRef<number | null>(null);
  const hasAnyQuickReaction = QUICK_REACTIONS.some((reaction) => reactions.has(reaction.emoji));

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

  const handleReaction = useCallback((emoji: string) => {
    if (!messageId || !emoji.trim()) return;
    const active = !reactions.has(emoji);
    setReaction(emoji, active);
    if (conversationId) {
      persistReaction.mutate({ messageId, emoji, active });
    }
    setReactionPickerOpen(false);
  }, [conversationId, messageId, persistReaction, reactions, setReaction]);

  if (side === "center") return null;

  return (
    <Toolbar.Root
      data-side={side}
      className="oa-message-hover-toolbar"
      aria-label="Message actions"
    >
      <Popover.Root
        open={reactionPickerOpen}
        onOpenChange={setReactionPickerOpen}
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label="Add reaction"
            aria-pressed={hasAnyQuickReaction}
            title="Add reaction"
            className="oa-message-action-btn"
          >
            <SmilePlus size={16} aria-hidden="true" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="top"
            align={side === "right" ? "start" : "end"}
            sideOffset={8}
            className="oa-emoji-popover"
          >
            <div className="oa-emoji-picker-shell">
              <EmojiPicker
                theme={Theme.DARK}
                lazyLoadEmojis
                width={340}
                height={380}
                reactionsDefaultOpen
                reactions={QUICK_REACTIONS.map((reaction) => reaction.unified)}
                allowExpandReactions
                previewConfig={{ showPreview: false }}
                onReactionClick={(emojiData) => handleReaction(emojiData.emoji)}
                onEmojiClick={(emojiData) => handleReaction(emojiData.emoji)}
              />
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

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
