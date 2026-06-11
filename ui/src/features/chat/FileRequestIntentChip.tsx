import { useState, useRef, useCallback } from "react";
import { FileSearch, Upload, FileText, X, CheckCircle, Loader2 } from "lucide-react";

interface FileRequestIntentChipProps {
  visible: boolean;
}

interface DroppedFile {
  name: string;
  size: number;
  type: string;
  previewUrl?: string;
}

type UploadStatus = "pending" | "uploading" | "done" | "error";

const FILE_REQUEST_PATTERN = /(?:find|get|search|show|send|fetch|locate|open)\s+(?:(?:me|us)\s+)?(?:the\s+)?(?:[\w-]+\s+){0,6}(?:file|document|pdf|spreadsheet|invoice|report|image)/i;

export function matchFileRequestIntent(text: string): boolean {
  return FILE_REQUEST_PATTERN.test(text.trim());
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function FileRequestIntentChip({ visible }: FileRequestIntentChipProps) {
  const [droppedFile, setDroppedFile] = useState<DroppedFile | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("pending");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      setDroppedFile({ name: file.name, size: file.size, type: file.type, previewUrl });
      setUploadStatus("pending");
      setUploadProgress(0);
    }
  }, []);

  const handleRemove = useCallback(() => {
    if (droppedFile?.previewUrl) URL.revokeObjectURL(droppedFile.previewUrl);
    setDroppedFile(null);
    setUploadStatus("pending");
    setUploadProgress(0);
  }, [droppedFile]);

  const simulateUpload = useCallback(() => {
    if (uploadStatus !== "pending" || !droppedFile) return;
    setUploadStatus("uploading");
    setUploadProgress(0);
    const interval = setInterval(() => {
      setUploadProgress((prev) => {
        const next = prev + Math.random() * 20;
        if (next >= 100) {
          clearInterval(interval);
          setUploadStatus("done");
          return 100;
        }
        return next;
      });
    }, 300);
  }, [uploadStatus, droppedFile]);

  if (!visible && !droppedFile && !dragOver) return null;

  return (
    <div className="space-y-2">
      {!droppedFile && visible && (
        <div className="flex items-center gap-1.5 rounded-full bg-oa-amber/15 px-2.5 py-1 text-[11px] font-medium text-oa-amber">
          <FileSearch className="h-3 w-3" />
          Sending as file request
        </div>
      )}

      <div
        ref={dropRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative rounded-xl border-2 border-dashed transition-colors ${
          dragOver
            ? "border-oa-blue bg-oa-blue/5"
            : droppedFile
              ? "border-oa-border bg-oa-surface"
              : "border-oa-border/40 bg-oa-surface/50"
        }`}
        role="button"
        tabIndex={0}
        aria-label="Drop zone for file upload"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (!droppedFile) {
              const input = document.createElement("input");
              input.type = "file";
              input.onchange = (ev) => {
                const file = (ev.target as HTMLInputElement).files?.[0];
                if (file) {
                  const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
                  setDroppedFile({ name: file.name, size: file.size, type: file.type, previewUrl });
                  setUploadStatus("pending");
                  setUploadProgress(0);
                }
              };
              input.click();
            }
          }
        }}
      >
        {!droppedFile ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-6">
            <Upload className={`h-5 w-5 ${dragOver ? "text-oa-blue" : "text-oa-text-muted"}`} />
            <span className={`text-xs ${dragOver ? "text-oa-blue" : "text-oa-text-muted"}`}>
              {dragOver ? "Drop file here" : "Drag & drop a file, or click to browse"}
            </span>
          </div>
        ) : (
          <div className="flex items-start gap-3 px-3 py-2.5">
            {droppedFile.previewUrl ? (
              <img
                src={droppedFile.previewUrl}
                alt={droppedFile.name}
                className="h-10 w-10 shrink-0 rounded-lg object-cover border border-oa-border"
              />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-oa-surface-2 border border-oa-border">
                <FileText className="h-5 w-5 text-oa-blue" />
              </div>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate text-xs font-medium text-oa-text">{droppedFile.name}</span>
              <span className="text-[10px] text-oa-text-muted">{formatSize(droppedFile.size)}</span>
              {uploadStatus === "uploading" && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-oa-surface-2">
                  <div
                    className="h-full rounded-full bg-oa-blue transition-all duration-200"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              )}
              {uploadStatus === "done" && (
                <span className="flex items-center gap-1 text-[10px] text-oa-green">
                  <CheckCircle className="h-3 w-3" />
                  Uploaded
                </span>
              )}
              {uploadStatus === "pending" && (
                <button
                  type="button"
                  onClick={simulateUpload}
                  className="flex items-center gap-1 text-[10px] text-oa-blue hover:text-oa-blue/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
                >
                  <Loader2 className="h-3 w-3" />
                  Start upload
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={handleRemove}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-oa-text-muted hover:text-oa-text hover:bg-oa-surface-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
              aria-label="Remove file"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
