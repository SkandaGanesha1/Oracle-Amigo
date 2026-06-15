import { useRef, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { ScrollButton } from "~/components/ui/scroll-button";
import { DateSeparator } from "./DateSeparator";
import { UnreadDivider } from "./UnreadDivider";
import { TypingIndicator } from "./TypingIndicator";
import { MessageBubble } from "./MessageBubble";
import { buildTimelineMeta, getUnreadMessageId } from "./timelineModel";
import { getTimelineScroll, saveTimelineScroll, type SavedTimelineScroll } from "./timelineScrollState";
import type { ConversationReadState, TimelineMessage } from "../../api/types";

function estimateMessageSize(message: TimelineMessage): number {
  if (message.kind === "human") {
    const lineCount = Math.ceil((message.text?.length ?? 0) / 88);
    return Math.max(34, 28 + lineCount * 20);
  }

  switch (message.kind) {
    case "file_request": return 150;
    case "approval": return 280;
    case "transfer": return 220;
    case "receipt": return 190;
    case "a2a_task": return 220;
    case "thinking_bar": return 92;
    case "system_event": return 44;
    default: return 64;
  }
}

interface VirtualizedMessageListProps {
  messages: TimelineMessage[];
  loading: boolean;
  onRetry?: (messageId: string) => void;
  typing?: boolean;
  conversationId?: string;
  hasMoreBefore?: boolean;
  loadingBefore?: boolean;
  loadBefore?: (beforeMessageId: string) => Promise<void>;
  unreadMessageId?: string | null;
  readState?: ConversationReadState | null;
  onMarkRead?: (messageId: string) => void;
  jumpToMessageId?: string | null;
  loadAroundMessage?: (messageId: string) => Promise<void>;
  typingLabel?: string;
}

interface LocalNewMessageState {
  firstNewMessageId?: string;
  count: number;
}

interface VirtualListProps {
  messages: TimelineMessage[];
  onRetry?: (messageId: string) => void;
  typing?: boolean;
  conversationId?: string;
  hasMoreBefore?: boolean;
  loadingBefore?: boolean;
  loadBefore?: (beforeMessageId: string) => Promise<void>;
  unreadMessageId?: string | null;
  readState?: ConversationReadState | null;
  onMarkRead?: (messageId: string) => void;
  jumpToMessageId?: string | null;
  loadAroundMessage?: (messageId: string) => Promise<void>;
}

function VirtualList({
  messages,
  onRetry,
  conversationId,
  hasMoreBefore,
  loadingBefore,
  loadBefore,
  unreadMessageId,
  readState,
  onMarkRead,
  jumpToMessageId,
  loadAroundMessage,
}: VirtualListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  const prevConversationRef = useRef<string | undefined>(undefined);
  const localStateConversationRef = useRef<string | undefined>(undefined);
  const previousMessageIdsRef = useRef<string[]>(messages.map((message) => message.id));
  const lastMarkedReadRef = useRef<string | null>(null);
  const loadingOlderRef = useRef(false);
  const pendingRestoreRef = useRef<SavedTimelineScroll | null>(null);
  const requestedJumpLoadRef = useRef<string | null>(null);
  const jumpHighlightTimerRef = useRef<number | null>(null);
  const [localNewMessageState, setLocalNewMessageState] = useState<LocalNewMessageState>({ count: 0 });
  const timelineMeta = useMemo(() => buildTimelineMeta(messages), [messages]);
  const persistedUnreadMessageId = useMemo(
    () => readState && readState.unreadCount > 0
      ? getUnreadMessageId(messages, readState.lastReadMessageId)
      : null,
    [messages, readState]
  );
  const effectiveUnreadMessageId = unreadMessageId ?? persistedUnreadMessageId;
  const newestMessageId = messages.at(-1)?.id;

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => estimateMessageSize(messages[index]),
    getItemKey: (index) => messages[index]?.id ?? index,
    overscan: 16,
  });

  const captureAnchor = useCallback((): SavedTimelineScroll | null => {
    const parent = parentRef.current;
    const firstVirtual = virtualizer.getVirtualItems()[0];
    if (!parent || !firstVirtual) return null;

    const message = messages[firstVirtual.index];
    if (!message) return null;

    return {
      scrollTop: parent.scrollTop,
      anchorMessageId: message.id,
      anchorOffset: parent.scrollTop - firstVirtual.start,
    };
  }, [messages, virtualizer]);

  const restoreAnchor = useCallback((anchor: SavedTimelineScroll) => {
    const parent = parentRef.current;
    if (!parent) return;

    if (!anchor.anchorMessageId) {
      parent.scrollTop = anchor.scrollTop;
      return;
    }

    const index = messages.findIndex((message) => message.id === anchor.anchorMessageId);
    if (index < 0) {
      parent.scrollTop = anchor.scrollTop;
      return;
    }

    virtualizer.scrollToIndex(index, { align: "start" });
    requestAnimationFrame(() => {
      const currentParent = parentRef.current;
      const item = virtualizer.getVirtualItems().find((virtualItem) => virtualItem.index === index);
      if (!item || !currentParent) return;
      currentParent.scrollTop = item.start + (anchor.anchorOffset ?? 0);
    });
  }, [messages, virtualizer]);

  const maybeLoadOlder = useCallback(async () => {
    if (!hasMoreBefore || loadingBefore || loadingOlderRef.current || !loadBefore) return;

    const firstVirtual = virtualizer.getVirtualItems()[0];
    if (!firstVirtual || firstVirtual.index > 4) return;

    const firstMessage = messages[firstVirtual.index];
    if (!firstMessage) return;

    const anchor = captureAnchor();
    if (!anchor) return;

    loadingOlderRef.current = true;
    pendingRestoreRef.current = anchor;
    try {
      await loadBefore(firstMessage.id);
    } finally {
      loadingOlderRef.current = false;
    }
  }, [captureAnchor, hasMoreBefore, loadBefore, loadingBefore, messages, virtualizer]);

  const handleScroll = useCallback(() => {
    if (!conversationId || !parentRef.current) return;

    const anchor = captureAnchor();
    saveTimelineScroll(conversationId, {
      scrollTop: parentRef.current.scrollTop,
      anchorMessageId: anchor?.anchorMessageId,
      anchorOffset: anchor?.anchorOffset,
    });

    void maybeLoadOlder();
  }, [captureAnchor, conversationId, maybeLoadOlder]);

  const markNewestRead = useCallback(() => {
    if (!newestMessageId || !onMarkRead || lastMarkedReadRef.current === newestMessageId) return;
    lastMarkedReadRef.current = newestMessageId;
    onMarkRead(newestMessageId);
  }, [newestMessageId, onMarkRead]);

  const jumpToLatest = useCallback(() => {
    setLocalNewMessageState({ count: 0 });
    scrollToBottom();
    markNewestRead();
  }, [markNewestRead, scrollToBottom]);

  useEffect(() => {
    const ids = messages.map((message) => message.id);
    if (localStateConversationRef.current !== conversationId) {
      localStateConversationRef.current = conversationId;
      previousMessageIdsRef.current = ids;
      setLocalNewMessageState({ count: 0 });
      lastMarkedReadRef.current = readState?.lastReadMessageId ?? null;
      return;
    }

    const previousIds = previousMessageIdsRef.current;
    const appended =
      previousIds.length > 0 &&
      ids.length > previousIds.length &&
      previousIds.every((id, index) => ids[index] === id)
        ? ids.slice(previousIds.length)
        : [];

    if (appended.length > 0 && !isAtBottom) {
      setLocalNewMessageState((current) => ({
        firstNewMessageId: current.firstNewMessageId ?? appended[0],
        count: current.count + appended.length,
      }));
    }

    if (isAtBottom) {
      setLocalNewMessageState({ count: 0 });
    }

    previousMessageIdsRef.current = ids;
  }, [conversationId, isAtBottom, messages, readState?.lastReadMessageId]);

  useEffect(() => {
    if (!isAtBottom) return;
    markNewestRead();
  }, [isAtBottom, markNewestRead]);

  useLayoutEffect(() => {
    const pending = pendingRestoreRef.current;
    if (!pending) return;

    pendingRestoreRef.current = null;
    requestAnimationFrame(() => {
      restoreAnchor(pending);
    });
  }, [messages.length, restoreAnchor]);

  useLayoutEffect(() => {
    if (prevConversationRef.current === conversationId) return;
    prevConversationRef.current = conversationId;
    if (!conversationId || !parentRef.current) return;

    const saved = getTimelineScroll(conversationId);
    if (!saved) {
      requestAnimationFrame(() => {
        if (messages.length > 0) {
          virtualizer.scrollToIndex(messages.length - 1, { align: "end" });
        }
      });
      return;
    }

    requestAnimationFrame(() => {
      restoreAnchor(saved);
    });
  }, [conversationId, messages.length, restoreAnchor, virtualizer]);

  useEffect(() => {
    if (!jumpToMessageId) return;

    const index = messages.findIndex((message) => message.id === jumpToMessageId);
    if (index >= 0) {
      requestedJumpLoadRef.current = null;
      virtualizer.scrollToIndex(index, { align: "center", behavior: "smooth" });

      requestAnimationFrame(() => {
        const element = document.getElementById(`message-${jumpToMessageId}`);
        element?.classList.add("oa-message-jump-highlight");
        if (jumpHighlightTimerRef.current !== null) {
          window.clearTimeout(jumpHighlightTimerRef.current);
        }
        jumpHighlightTimerRef.current = window.setTimeout(() => {
          element?.classList.remove("oa-message-jump-highlight");
          jumpHighlightTimerRef.current = null;
        }, 1800);
      });
      return;
    }

    if (loadAroundMessage && requestedJumpLoadRef.current !== jumpToMessageId) {
      requestedJumpLoadRef.current = jumpToMessageId;
      void loadAroundMessage(jumpToMessageId);
    }
  }, [jumpToMessageId, loadAroundMessage, messages, virtualizer]);

  useEffect(() => {
    return () => {
      if (jumpHighlightTimerRef.current !== null) {
        window.clearTimeout(jumpHighlightTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="relative flex-1">
      {loadingBefore && (
        <div className="pointer-events-none absolute left-0 right-0 top-3 z-10 flex justify-center">
          <span className="rounded-full border border-oa-border bg-oa-surface/95 px-3 py-1 text-[10px] text-oa-text-muted shadow-sm">
            Loading older messages...
          </span>
        </div>
      )}
      <div
        ref={parentRef}
        className="oa-chat-scroll absolute inset-0"
        style={{
          overscrollBehavior: "contain",
          contain: "strict",
          overflowAnchor: "none",
        }}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-label="Message list"
        aria-relevant="additions"
      >
        <div
          className="oa-chat-lane"
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const message = messages[virtualItem.index];
            if (!message) return null;
            const rowMeta = timelineMeta.get(message.id);
            const isNewDivider = localNewMessageState.firstNewMessageId === message.id && localNewMessageState.count > 0;
            const isUnreadDivider = effectiveUnreadMessageId === message.id;

            return (
              <div
                key={message.id}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                {rowMeta?.showDateSeparator && (
                  <DateSeparator date={new Date(rowMeta.createdAt)} />
                )}
                {isUnreadDivider && (
                  <UnreadDivider
                    label="Unread messages"
                    count={readState?.unreadCount ?? messages.length - virtualItem.index}
                    onJumpToLatest={jumpToLatest}
                  />
                )}
                {isNewDivider && (
                  <UnreadDivider
                    label="New messages"
                    count={localNewMessageState.count}
                    onJumpToLatest={jumpToLatest}
                  />
                )}
                <MessageBubble
                  message={message}
                  onRetry={onRetry}
                  grouped={rowMeta?.groupedWithPrevious}
                  meta={rowMeta}
                />
              </div>
            );
          })}
        </div>
      </div>
      {!isAtBottom && (
        <div className="absolute bottom-4 right-6 z-10 flex flex-col gap-2">
          <ScrollButton />
        </div>
      )}
      {localNewMessageState.count > 0 && (
        <div className="absolute bottom-16 right-6 z-10">
          <button
            type="button"
            onClick={jumpToLatest}
            className="flex min-h-[48px] items-center gap-1.5 rounded-full bg-oa-blue px-4 py-2 text-xs font-medium text-white shadow-md transition-colors hover:bg-oa-blue/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
          >
            Jump to latest
          </button>
        </div>
      )}
    </div>
  );
}

export function VirtualizedMessageList({
  messages,
  loading,
  onRetry,
  typing,
  conversationId,
  hasMoreBefore,
  loadingBefore,
  loadBefore,
  unreadMessageId,
  readState,
  onMarkRead,
  jumpToMessageId,
  loadAroundMessage,
  typingLabel,
}: VirtualizedMessageListProps) {
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center" role="status" aria-live="polite" aria-label="Loading messages">
        <div className="flex flex-col items-center gap-3">
          <div className="flex gap-1">
            <span className="h-2 w-2 animate-bounce rounded-full bg-oa-text-muted" style={{ animationDelay: "0ms" }} />
            <span className="h-2 w-2 animate-bounce rounded-full bg-oa-text-muted" style={{ animationDelay: "150ms" }} />
            <span className="h-2 w-2 animate-bounce rounded-full bg-oa-text-muted" style={{ animationDelay: "300ms" }} />
          </div>
          <p className="text-xs text-oa-text-muted">Loading messages...</p>
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center px-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-oa-surface ring-1 ring-oa-border">
            <svg className="h-6 w-6 text-oa-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-oa-text-muted">No messages yet</p>
          <p className="text-xs text-oa-text-disabled">Start the conversation by typing a message below</p>
        </div>
      </div>
    );
  }

  const showTyping = Boolean(typing);

  return (
    <StickToBottom className="flex flex-1" resize="smooth" initial="instant">
      <VirtualList
        messages={messages}
        onRetry={onRetry}
        typing={typing}
        conversationId={conversationId}
        hasMoreBefore={hasMoreBefore}
        loadingBefore={loadingBefore}
        loadBefore={loadBefore}
        unreadMessageId={unreadMessageId}
        readState={readState}
        onMarkRead={onMarkRead}
        jumpToMessageId={jumpToMessageId}
        loadAroundMessage={loadAroundMessage}
      />
      {showTyping && <TypingIndicator label={typingLabel} />}
    </StickToBottom>
  );
}
