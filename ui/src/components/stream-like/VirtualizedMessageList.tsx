import { useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { ScrollButton } from "~/components/ui/scroll-button";
import { DateSeparator } from "./DateSeparator";
import { UnreadDivider } from "./UnreadDivider";
import { TypingIndicator } from "./TypingIndicator";
import { MessageBubble } from "./MessageBubble";
import type { TimelineMessage, FileReceiptMessage } from "../../api/types";

function messageDate(message: TimelineMessage): string {
  if (message.kind === "receipt") return (message as FileReceiptMessage).received_at;
  return message.created_at;
}

function estimateMessageSize(message: TimelineMessage): number {
  switch (message.kind) {
    case "approval": return 340;
    case "a2a_task": return 300;
    case "transfer": return 180;
    case "receipt": return 160;
    case "file_request": return 140;
    case "thinking_bar": return 220;
    case "system_event": return 72;
    default: return 100;
  }
}

interface VirtualizedMessageListProps {
  messages: TimelineMessage[];
  loading: boolean;
  onRetry?: (messageId: string) => void;
  typing?: boolean;
  conversationId?: string;
}

function VirtualList({ messages, onRetry, typing, conversationId }: { messages: TimelineMessage[]; onRetry?: (messageId: string) => void; typing?: boolean; conversationId?: string }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  const lastCountRef = useRef(messages.length);
  const scrollPositions = useRef<Map<string, number>>(new Map());

  const prevConversationRef = useRef(conversationId);
  const hasNewWhileScrolled = messages.length > lastCountRef.current && !isAtBottom;
  if (isAtBottom) lastCountRef.current = messages.length;

  const handleScroll = useCallback(() => {
    if (conversationId && parentRef.current) {
      scrollPositions.current.set(conversationId, parentRef.current.scrollTop);
    }
  }, [conversationId]);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => estimateMessageSize(messages[index]),
    overscan: 5,
  });

  if (prevConversationRef.current !== conversationId) {
    prevConversationRef.current = conversationId;
    const saved = conversationId ? scrollPositions.current.get(conversationId) : undefined;
    if (saved !== undefined && parentRef.current) {
      requestAnimationFrame(() => {
        if (parentRef.current) {
          parentRef.current.scrollTop = saved;
        }
      });
    }
  }

  const dateSeparators = useRef<Set<number>>(new Set());
  dateSeparators.current.clear();
  let lastDate = "";
  for (let i = 0; i < messages.length; i++) {
    const d = new Date(messageDate(messages[i])).toDateString();
    if (d !== lastDate) {
      dateSeparators.current.add(i);
      lastDate = d;
    }
  }

  return (
    <div className="relative flex-1">
      <div
        ref={parentRef}
        className="absolute inset-0 overflow-y-auto"
        style={{ overscrollBehavior: "contain" }}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-label="Message list"
        aria-relevant="additions"
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const message = messages[virtualItem.index];
            const isNewDivider = virtualItem.index === lastCountRef.current && hasNewWhileScrolled;

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
                {dateSeparators.current.has(virtualItem.index) && (
                  <DateSeparator date={new Date(messageDate(message))} />
                )}
                {isNewDivider && (
                  <UnreadDivider
                    count={messages.length - lastCountRef.current}
                    onJumpToLatest={scrollToBottom}
                  />
                )}
                <MessageBubble message={message} onRetry={onRetry} />
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
      {hasNewWhileScrolled && (
        <div className="absolute bottom-16 right-6 z-10">
          <button
            type="button"
            onClick={() => scrollToBottom()}
            className="flex min-h-[48px] items-center gap-1.5 rounded-full bg-oa-blue px-4 py-2 text-xs font-medium text-white shadow-md transition-colors hover:bg-oa-blue/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
          >
            Jump to latest
          </button>
        </div>
      )}
    </div>
  );
}

export function VirtualizedMessageList({ messages, loading, onRetry, typing, conversationId }: VirtualizedMessageListProps) {
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
      />
      {showTyping && <TypingIndicator />}
    </StickToBottom>
  );
}
