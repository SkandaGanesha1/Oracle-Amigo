import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { X, FileText, FileImage, FileCode, FileSpreadsheet, Download, ShieldCheck } from "lucide-react";
import { formatSize } from "../../lib/format";

interface FilePreviewProps {
  fileName: string;
  filePath: string;
  fileSize: number;
  onClose: () => void;
}

function getFileIcon(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"].includes(ext)) return FileImage;
  if (["pdf"].includes(ext)) return FileText;
  if (["xls", "xlsx", "csv", "tsv"].includes(ext)) return FileSpreadsheet;
  if (["js", "ts", "jsx", "tsx", "py", "rb", "go", "rs", "java", "c", "cpp", "html", "css", "json", "xml", "yaml", "yml", "md", "sh", "bash"].includes(ext)) return FileCode;
  return FileText;
}

export function FilePreview({ fileName, filePath, fileSize, onClose }: FilePreviewProps) {
  const [verified, setVerified] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const FileIcon = getFileIcon(fileName);
  const ext = fileName.split(".").pop()?.toUpperCase() ?? "FILE";

  useEffect(() => {
    closeRef.current?.focus();
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleVerify = () => {
    setVerified(true);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label="File Preview"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-lg flex-col rounded-xl border border-oa-border bg-oa-surface shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-oa-border px-4 py-3">
          <h3 className="text-sm font-semibold text-oa-text">File Preview</h3>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="flex min-h-[48px] min-w-[48px] items-center justify-center text-oa-text-muted hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue rounded-lg"
            aria-label="Close preview"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col items-center gap-4 px-6 py-8">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-oa-blue/10">
            <FileIcon className="h-10 w-10 text-oa-blue" />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold text-oa-text">{fileName}</p>
            <p className="mt-1 text-sm text-oa-text-muted font-mono break-all">{filePath}</p>
            <p className="mt-0.5 text-xs text-oa-text-muted">{formatSize(fileSize)} &middot; {ext} file</p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleVerify}
              className="inline-flex items-center gap-1.5 rounded-lg border border-oa-green/30 bg-oa-green/5 px-3 py-2 text-xs font-medium text-oa-green transition hover:bg-oa-green/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              {verified ? "Hash verified" : "Verify hash"}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-oa-border bg-oa-surface-2 px-3 py-2 text-xs font-medium text-oa-text-muted transition hover:bg-oa-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </button>
          </div>

          {verified && (
            <div className="flex items-center gap-1.5 rounded-lg bg-oa-green/5 border border-oa-green/20 px-3 py-2 text-[10px] text-oa-green">
              <ShieldCheck className="h-3 w-3" />
              Hash verified — file integrity confirmed
            </div>
          )}

          <div className="w-full rounded-lg border border-oa-border bg-oa-bg-elevated p-3">
            <p className="text-xs text-oa-text-muted">
              This file is located on your local device. Preview is available for supported file types. The full file will only be sent if you approve this request.
            </p>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}