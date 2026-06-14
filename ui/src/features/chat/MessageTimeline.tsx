import { VirtualizedMessageList } from "../../components/stream-like/VirtualizedMessageList";
import type { ConversationReadState, TimelineMessage } from "../../api/types";

interface MessageTimelineProps {
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

export function MessageTimeline({
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
}: MessageTimelineProps) {
  return (
    <div className="chat-canvas relative flex flex-1 flex-col" role="log" aria-live="polite" aria-atomic="false" aria-label="Message timeline">
      <VirtualizedMessageList
        messages={messages}
        loading={loading}
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
        typingLabel={typingLabel}
      />
    </div>
  );
}
