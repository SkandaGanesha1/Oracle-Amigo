import { VirtualizedMessageList } from "../../components/stream-like/VirtualizedMessageList";
import type { TimelineMessage } from "../../api/types";

interface MessageTimelineProps {
  messages: TimelineMessage[];
  loading: boolean;
  onRetry?: (messageId: string) => void;
  typing?: boolean;
  conversationId?: string;
}

export function MessageTimeline({ messages, loading, onRetry, typing, conversationId }: MessageTimelineProps) {
  return (
    <div className="chat-canvas relative flex flex-1 flex-col" role="log" aria-live="polite" aria-atomic="false" aria-label="Message timeline">
      <VirtualizedMessageList
        messages={messages}
        loading={loading}
        onRetry={onRetry}
        typing={typing}
        conversationId={conversationId}
      />
    </div>
  );
}
