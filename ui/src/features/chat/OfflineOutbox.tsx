import { useState } from "react";
import { WifiOff, Clock, X, Send } from "lucide-react";

interface QueuedMessage {
  id: string;
  text: string;
  queuedAt: Date;
}

interface OfflineOutboxProps {
  messages: QueuedMessage[];
  onSendNow: (id: string) => void;
  onDismiss: (id: string) => void;
}

export function OfflineOutbox({ messages, onSendNow, onDismiss }: OfflineOutboxProps) {
  if (messages.length === 0) return null;

  return (
    <div className="border-t border-oa-amber/20 bg-oa-amber/5 px-4 py-2">
      <div className="flex items-center gap-2 mb-2">
        <WifiOff className="h-3.5 w-3.5 text-oa-amber" />
        <span className="text-xs font-medium text-oa-amber">Offline — {messages.length} message{messages.length !== 1 ? "s" : ""} queued</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {messages.map((msg) => (
          <div key={msg.id} className="flex items-center gap-2 rounded-lg border border-oa-border bg-oa-surface px-3 py-2">
            <Clock className="h-3 w-3 shrink-0 text-oa-text-muted" />
            <span className="flex-1 truncate text-xs text-oa-text-muted">{msg.text}</span>
            <button
              type="button"
              onClick={() => onSendNow(msg.id)}
              className="flex h-6 items-center gap-1 rounded-md bg-oa-blue/20 px-2 text-[10px] font-medium text-oa-blue transition-colors hover:bg-oa-blue/30"
            >
              <Send className="h-3 w-3" />
              Send now
            </button>
            <button
              type="button"
              onClick={() => onDismiss(msg.id)}
              className="flex h-6 w-6 items-center justify-center rounded text-oa-text-muted transition-colors hover:bg-oa-surface-2 hover:text-oa-text"
              aria-label="Dismiss"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
