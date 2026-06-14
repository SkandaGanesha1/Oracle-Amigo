import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { ContextMenu } from "radix-ui";
import { Activity, AlertCircle, Check, Copy, ExternalLink, FileCheck, Shield, Upload, Download, RotateCw } from "lucide-react";
import { safeDisplayText } from "../../lib/safeText";
import type { TransferProgressMessage as TransferProgressMessageType } from "../../api/types";

interface TransferProgressMessageProps {
  message: TransferProgressMessageType;
}

export function TransferProgressMessage({ message }: TransferProgressMessageProps) {
  const [copied, setCopied] = useState<"hash" | "id" | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const statusConfig: Record<string, { icon: typeof Upload; color: string; label: string }> = {
    preparing: { icon: RotateCw, color: "text-oa-amber", label: "Preparing" },
    uploading: { icon: Upload, color: "text-oa-blue", label: "Uploading" },
    downloading: { icon: Download, color: "text-oa-cyan", label: "Downloading" },
    verifying: { icon: Shield, color: "text-oa-purple", label: "Verifying" },
    stored: { icon: FileCheck, color: "text-oa-green", label: "Stored" },
    available: { icon: FileCheck, color: "text-oa-green", label: "Available" },
    failed: { icon: AlertCircle, color: "text-oa-red", label: "Failed" },
  };

  const config = statusConfig[message.status] ?? { icon: Activity, color: "text-oa-text-muted", label: message.status };
  const Icon = config.icon;
  const progress = Math.min(100, Math.max(0, message.progress_percent));
  const isFailed = message.status === "failed";
  const isComplete = message.status === "stored" || message.status === "available";
  const fileName = safeDisplayText(message.file_name);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const copyValue = useCallback(async (value: string, type: "hash" | "id") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(type);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        copyTimerRef.current = null;
        setCopied(null);
      }, 1600);
    } catch {
      // Clipboard can be unavailable in restricted browser contexts.
    }
  }, []);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <motion.div
          layout
          className="rounded-xl card-transfer-progress border p-4 shadow-lg shadow-black/10"
          role="region"
          aria-label={`File transfer: ${fileName} - ${config.label}`}
        >
          <div className="flex items-start gap-3">
            <motion.div
              layout
              className={`flex h-8 w-8 items-center justify-center rounded-lg ${isFailed ? "bg-oa-red/10" : isComplete ? "bg-oa-green/10" : "bg-oa-blue/10"}`}
              animate={isComplete ? { scale: [1, 1.08, 1] } : undefined}
              transition={{ duration: 0.35, ease: "easeOut" }}
            >
              <Icon className={`card-icon h-4 w-4 ${message.status === "uploading" || message.status === "downloading" ? "animate-pulse" : ""}`} />
            </motion.div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">
                  File Transfer
                </h3>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${isFailed ? "bg-oa-red/10 text-oa-red" : isComplete ? "bg-oa-green/10 text-oa-green" : "bg-oa-blue/10 text-oa-blue"}`}>
                  {config.label}
                </span>
              </div>
              <p className="mt-1 truncate text-sm font-medium text-oa-text" title={fileName}>{fileName}</p>
              <p className="text-[11px] text-oa-text-muted">
                {formatSize(message.size_bytes)} - SHA-256: <span className="font-mono">{message.sha256.slice(0, 16)}...</span>
              </p>

              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between text-[10px] text-oa-text-muted">
                  <span>Progress</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-oa-bg">
                  <motion.div
                    className={`h-full rounded-full ${isFailed ? "bg-oa-red" : isComplete ? "bg-oa-green" : "bg-oa-blue"}`}
                    initial={false}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.45, ease: "easeOut" }}
                  />
                </div>
              </div>

              {!isComplete && !isFailed && (
                <div className="mt-2 flex items-center gap-1.5 text-[10px] text-oa-text-muted">
                  <Activity className="h-3 w-3" />
                  {message.status === "uploading" && "Transferring to recipient..."}
                  {message.status === "downloading" && "Receiving from sender..."}
                  {message.status === "verifying" && "Verifying file integrity..."}
                  {message.status === "preparing" && "Preparing file for transfer..."}
                </div>
              )}

              {isComplete && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void copyValue(message.sha256, "hash")}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-oa-border bg-oa-surface-2 px-3 text-[10px] text-oa-text-muted transition hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
                  >
                    {copied === "hash" ? <Check className="h-3 w-3 text-oa-green" /> : <Copy className="h-3 w-3" />}
                    {copied === "hash" ? "Hash copied" : "Copy hash"}
                  </button>
                  <Link
                    to="/files"
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-oa-border bg-oa-surface-2 px-3 text-[10px] text-oa-text-muted transition hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
                  >
                    <ExternalLink className="h-3 w-3" />
                    View in Files
                  </Link>
                </div>
              )}

              {isFailed && (
                <div className="mt-3 rounded-lg border border-oa-red/20 bg-oa-red/5 p-2 text-[10px] text-oa-red">
                  Transfer failed. Check the requester connection and retry the file request from the conversation.
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Content className="context-menu-surface z-[80] min-w-48 rounded-lg p-1">
          <ContextMenu.Item className="context-menu-item" onSelect={() => void copyValue(message.sha256, "hash")}>
            {copied === "hash" ? <Check className="h-3.5 w-3.5 text-oa-green" /> : <Copy className="h-3.5 w-3.5" />}
            Copy SHA-256 hash
          </ContextMenu.Item>
          <ContextMenu.Item className="context-menu-item" onSelect={() => void copyValue(message.transfer_id, "id")}>
            {copied === "id" ? <Check className="h-3.5 w-3.5 text-oa-green" /> : <Copy className="h-3.5 w-3.5" />}
            Copy transfer ID
          </ContextMenu.Item>
          {isComplete && (
            <ContextMenu.Item className="context-menu-item" asChild>
              <Link to="/files">
                <ExternalLink className="h-3.5 w-3.5" />
                View in Files
              </Link>
            </ContextMenu.Item>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
