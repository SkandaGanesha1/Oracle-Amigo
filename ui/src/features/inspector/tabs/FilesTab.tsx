import { useReceivedFiles } from "../../../hooks/queries";
import { filesApi } from "../../../api/client";
import { Loader2, FileText, Download, ExternalLink, File, Clock, HardDrive, Hash, Eye } from "lucide-react";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncateHash(hash: string): string {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
}

export function FilesTab() {
  const { data, isLoading } = useReceivedFiles();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-oa-text-muted" />
      </div>
    );
  }

  const files = data?.files ?? [];

  if (files.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-oa-surface ring-1 ring-oa-border">
          <FileText className="h-5 w-5 text-oa-text-muted" />
        </div>
        <h3 className="text-sm font-medium text-oa-text-muted">Received Files</h3>
        <p className="mt-1 text-xs text-oa-text-disabled">No files received yet</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">
        Received Files ({files.length})
      </h3>

      <div className="space-y-1.5">
        {files.map((file) => {
          const date = new Date(file.receivedAt);
          const dateStr = date.toLocaleDateString([], { month: "short", day: "numeric" });
          const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

          return (
            <div
              key={file.id}
              className="rounded-md bg-oa-surface px-2.5 py-2 ring-1 ring-oa-border/50"
            >
              <div className="flex items-start gap-2.5">
                <File className="mt-0.5 h-4 w-4 shrink-0 text-oa-blue" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-[11px] font-medium text-oa-text">
                    {file.originalFileName}
                  </span>

                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-oa-text-muted">
                    <span className="flex items-center gap-1">
                      <HardDrive className="h-3 w-3" />
                      {formatSize(file.sizeBytes)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {dateStr} {timeStr}
                    </span>
                    <span className="flex items-center gap-1 font-mono">
                      <Hash className="h-3 w-3" />
                      {truncateHash(file.sha256)}
                    </span>
                  </div>
                </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <a
                      href={filesApi.downloadUrl(file.id)}
                      className="inline-flex items-center gap-1 rounded border border-oa-border bg-oa-surface-2 px-2 py-0.5 text-[10px] text-oa-text-muted transition-colors hover:bg-oa-surface hover:text-oa-text"
                      download
                      title="Download file"
                    >
                      <Download className="h-3 w-3" />
                    </a>
                    <button
                      type="button"
                      onClick={() => window.open(filesApi.openUrl(file.id), "_blank")}
                      className="inline-flex items-center gap-1 rounded border border-oa-border bg-oa-surface-2 px-2 py-0.5 text-[10px] text-oa-text-muted transition-colors hover:bg-oa-surface hover:text-oa-text"
                      title="Open file"
                    >
                      <Eye className="h-3 w-3" />
                    </button>
                  </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
