import { useReceivedFiles } from "../../hooks/queries";
import { FileTypeIcon } from "./FileTypeIcon";
import { VerifyHashButton } from "./VerifyHashButton";
import { formatSize } from "../../lib/format";
import { HardDrive, Download } from "lucide-react";

export function ReceivedFilesPanel() {
  const { data, isLoading } = useReceivedFiles();
  const files = data?.files ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="flex gap-1">
          <span className="h-2 w-2 animate-bounce rounded-full bg-oa-text-muted" style={{ animationDelay: "0ms" }} />
          <span className="h-2 w-2 animate-bounce rounded-full bg-oa-text-muted" style={{ animationDelay: "150ms" }} />
          <span className="h-2 w-2 animate-bounce rounded-full bg-oa-text-muted" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2">
        <HardDrive className="h-6 w-6 text-oa-text-muted" />
        <p className="text-xs text-oa-text-disabled">No received files yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {files.map((file) => {
        const ext = file.originalFileName.split(".").pop() ?? "";
        return (
          <div
            key={file.id}
            className="flex items-center gap-3 rounded-lg border border-oa-border bg-oa-surface p-2.5"
          >
            <FileTypeIcon extension={ext} className="h-5 w-5 shrink-0 text-oa-text-muted" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-oa-text">{file.originalFileName}</p>
              <div className="flex items-center gap-2 text-[10px] text-oa-text-muted">
                <span>{formatSize(file.sizeBytes)}</span>
                <span className="text-oa-text-disabled">&middot;</span>
                <span className="font-mono">{file.sha256.slice(0, 12)}...</span>
                <span className="text-oa-text-disabled">&middot;</span>
                <span>{new Date(file.receivedAt).toLocaleDateString()}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <VerifyHashButton fileId={file.id} />
              <a
                href={`/storage/files/${file.id}/download`}
                className="inline-flex items-center gap-1 rounded border border-oa-border bg-oa-surface-2 px-2 py-1 text-[10px] text-oa-text-muted transition hover:bg-oa-surface"
                download
              >
                <Download className="h-3 w-3" />
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
}
