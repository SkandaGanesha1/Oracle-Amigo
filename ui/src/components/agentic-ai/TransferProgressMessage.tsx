import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, ExternalLink, RotateCw } from "lucide-react";
import { DocumentPreviewCard, type ChatDocumentPreview } from "../stream-like/DocumentPreviewCard";
import { safeDisplayText } from "../../lib/safeText";
import type { TransferProgressMessage as TransferProgressMessageType } from "../../api/types";

interface TransferProgressMessageProps {
  message: TransferProgressMessageType;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function transferStatus(status: string): ChatDocumentPreview["status"] {
  if (status === "failed") return "failed";
  if (status === "stored" || status === "available") return "sent";
  return "pending_approval";
}

export function TransferProgressMessage({ message }: TransferProgressMessageProps) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  const progress = Math.min(100, Math.max(0, message.progress_percent));
  const isComplete = message.status === "stored" || message.status === "available";
  const isFailed = message.status === "failed";
  const fileName = safeDisplayText(message.file_name);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const copyHash = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.sha256);
      setCopied(true);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        copyTimerRef.current = null;
        setCopied(false);
      }, 1600);
    } catch {
      // Clipboard can be unavailable in restricted browser contexts.
    }
  }, [message.sha256]);

  const file: ChatDocumentPreview = {
    id: message.transfer_id,
    name: fileName,
    mimeType: "file",
    sizeLabel: formatSize(message.size_bytes),
    sha256: message.sha256,
    status: transferStatus(message.status),
    verified: isComplete,
  };

  return (
    <section className="oa-agent-card" role="region" aria-label={`File transfer: ${fileName}`}>
      <div className="oa-agent-card-header">
        <div className="min-w-0">
          <div className="oa-agent-card-kicker">File transfer</div>
          <h3 className="oa-agent-card-title">{isComplete ? "Transfer complete" : isFailed ? "Transfer failed" : "Transfer in progress"}</h3>
        </div>
        <span className={`oa-doc-chip ${isFailed ? "danger" : isComplete ? "success" : ""}`}>{message.status}</span>
      </div>

      <DocumentPreviewCard
        file={file}
        secondaryAction={
          <button type="button" onClick={copyHash} className="oa-doc-action">
            {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
            {copied ? "Hash copied" : "Copy hash"}
          </button>
        }
        primaryAction={isComplete ? (
          <Link to="/files" className="oa-doc-action">
            <ExternalLink size={16} aria-hidden="true" />
            View in Files
          </Link>
        ) : undefined}
      />

      <div className="oa-transfer-progress" aria-label={`Transfer progress ${progress}%`}>
        <div className="flex items-center justify-between text-[11px] text-oa-chat-muted">
          <span className="inline-flex items-center gap-1">
            {!isComplete && !isFailed && <RotateCw size={12} className="animate-spin" aria-hidden="true" />}
            {isFailed ? "Needs attention" : isComplete ? "Verified and stored" : "Working"}
          </span>
          <span>{progress}%</span>
        </div>
        <div className="oa-transfer-progress-track">
          <div
            className={`oa-transfer-progress-fill ${isFailed ? "failed" : isComplete ? "complete" : ""}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {isFailed && (
        <div className="oa-agent-card-panel text-xs text-oa-red">
          Transfer failed. Check the requester connection and retry the file request from the conversation.
        </div>
      )}
    </section>
  );
}
