import { FileSearch, Target, User, FileText } from "lucide-react";
import type { FileRequestMessage as FileRequestMessageType } from "../../api/types";

interface FileRequestMessageProps {
  message: FileRequestMessageType;
}

export function FileRequestMessage({ message }: FileRequestMessageProps) {
  return (
    <div className="rounded-xl border border-oa-border bg-oa-surface p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-oa-pink/10">
          <FileSearch className="h-4 w-4 text-oa-pink" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">
            File Request
          </h3>
          <p className="mt-1 text-sm text-oa-text">{message.natural_language_request}</p>

          <div className="mt-3 space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-oa-text-muted">
              <User className="h-3 w-3" />
              <span>Requester: {message.requester}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-oa-text-muted">
              <Target className="h-3 w-3" />
              <span>Target: {message.target}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-oa-text-muted">
              <FileText className="h-3 w-3" />
              <span>Query: &ldquo;{message.query}&rdquo;</span>
            </div>
          </div>

          <div className="mt-3">
            <span className="rounded-full border border-oa-border bg-oa-bg-elevated px-2 py-0.5 text-[10px] font-medium text-oa-text-muted">
              {message.status}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
