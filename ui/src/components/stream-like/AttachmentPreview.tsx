import { FileText, X } from "lucide-react";

interface AttachmentPreviewProps {
  fileName: string;
  fileSize?: number;
  onRemove: () => void;
}

export function AttachmentPreview({ fileName, fileSize, onRemove }: AttachmentPreviewProps) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-oa-border bg-oa-surface px-3 py-2">
      <FileText className="h-4 w-4 shrink-0 text-oa-blue" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs font-medium text-oa-text">{fileName}</span>
        {fileSize !== undefined && (
          <span className="text-[10px] text-oa-text-muted">
            {fileSize < 1024 ? `${fileSize} B` : fileSize < 1048576 ? `${(fileSize / 1024).toFixed(1)} KB` : `${(fileSize / 1048576).toFixed(1)} MB`}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="flex h-5 w-5 items-center justify-center rounded text-oa-text-muted transition-colors hover:bg-oa-surface-2 hover:text-oa-text"
        aria-label="Remove attachment"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
