import { Upload, FileText, CheckCircle, Clock } from "lucide-react";
import { formatSize } from "../../lib/format";

interface SentFileEntry {
  id: string;
  fileName: string;
  sizeBytes: number;
  recipient: string;
  status: "sending" | "sent" | "delivered" | "failed";
  sentAt: string;
}

interface SentFilesPanelProps {
  files: SentFileEntry[];
}

const statusConfig: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
  sending: { icon: Clock, color: "text-oa-amber", label: "Sending..." },
  sent: { icon: CheckCircle, color: "text-oa-blue", label: "Sent" },
  delivered: { icon: CheckCircle, color: "text-oa-green", label: "Delivered" },
  failed: { icon: Clock, color: "text-oa-red", label: "Failed" },
};

export function SentFilesPanel({ files }: SentFilesPanelProps) {
  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2">
        <Upload className="h-6 w-6 text-oa-text-muted" />
        <p className="text-xs text-oa-text-disabled">No files sent yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {files.map((file) => {
        const config = statusConfig[file.status] ?? statusConfig.sent;
        const Icon = config.icon;
        return (
          <div
            key={file.id}
            className="flex items-center gap-3 rounded-lg border border-oa-border bg-oa-surface p-2.5"
          >
            <FileText className="h-5 w-5 shrink-0 text-oa-text-muted" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-oa-text">{file.fileName}</p>
              <div className="flex items-center gap-2 text-[10px] text-oa-text-muted">
                <span>{formatSize(file.sizeBytes)}</span>
                <span className="text-oa-text-disabled">&middot;</span>
                <span>to {file.recipient}</span>
              </div>
            </div>
            <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${config.color}`}>
              <Icon className="h-3 w-3" />
              {config.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
