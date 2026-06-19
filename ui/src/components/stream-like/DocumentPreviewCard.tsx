import { AlertTriangle, Download, Eye, File, FileText, Lock, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

export interface ChatDocumentPreview {
  id: string;
  name: string;
  mimeType: string;
  sizeLabel?: string;
  sha256?: string;
  thumbnailUrl?: string | null;
  previewText?: string | null;
  matchLabel?: string | null;
  status?: "requested" | "pending_approval" | "approved" | "sent" | "received" | "blocked" | "failed";
  sensitivity?: "low" | "medium" | "high";
  leavesDevice?: boolean;
  verified?: boolean;
}

function FileIcon({ mimeType }: { mimeType: string }) {
  const Icon = mimeType === "application/pdf" || mimeType.includes("pdf") ? FileText : File;
  return <Icon size={28} aria-hidden="true" />;
}

function statusLabel(status: ChatDocumentPreview["status"]): string {
  if (status === "blocked") return "Blocked";
  if (status === "failed") return "Failed";
  return "";
}

function decodeFileName(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name.replace(/%20/g, " ");
  }
}

function mimeLabel(mimeType: string): string {
  if (!mimeType) return "";
  if (mimeType === "file") return "File";
  if (mimeType.startsWith(".")) return mimeType.slice(1).toUpperCase();
  if (mimeType.includes("pdf")) return "PDF";
  return mimeType;
}

function sensitivityLabel(sensitivity: ChatDocumentPreview["sensitivity"]): string {
  if (sensitivity === "high" || sensitivity === "medium") return "Sensitive";
  if (sensitivity === "low") return "Low sensitivity";
  return "";
}

export function DocumentPreviewCard({
  file,
  primaryAction,
  secondaryAction,
}: {
  file: ChatDocumentPreview;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
}) {
  const displayName = decodeFileName(file.name);
  const status = statusLabel(file.status);
  const sensitivity = sensitivityLabel(file.sensitivity);
  return (
    <article className="oa-doc-card" aria-label={`Document preview: ${displayName}`}>
      <div className="oa-doc-thumb" aria-hidden="true">
        {file.thumbnailUrl ? (
          <img src={file.thumbnailUrl} alt="" loading="lazy" />
        ) : (
          <FileIcon mimeType={file.mimeType} />
        )}
      </div>

      <div className="oa-doc-body">
        <div className="oa-doc-title-row">
          <h4 className="oa-doc-title" title={displayName}>{displayName}</h4>
        </div>

        <div className="oa-doc-meta">
          {file.sizeLabel && <span>{file.sizeLabel}</span>}
          {file.mimeType && <span>{mimeLabel(file.mimeType)}</span>}
          {file.matchLabel && <span>{file.matchLabel}</span>}
          {file.sha256 && <span>SHA-256 {file.sha256.slice(0, 10)}...</span>}
        </div>

        {file.previewText && (
          <pre className="oa-doc-preview-text">{file.previewText}</pre>
        )}

        <div className="oa-doc-chip-row">
          {sensitivity && <span className="oa-doc-chip">{sensitivity}</span>}
          {file.leavesDevice && (
            <span className="oa-doc-chip warning">
              <Lock size={12} aria-hidden="true" />
              Leaves device
            </span>
          )}
          {file.verified && (
            <span className="oa-doc-chip success">
              <ShieldCheck size={12} aria-hidden="true" />
              Hash verified
            </span>
          )}
          {status && (
            <span className="oa-doc-chip danger">
              <AlertTriangle size={12} aria-hidden="true" />
              {status}
            </span>
          )}
        </div>

        {(primaryAction || secondaryAction) && (
          <div className="oa-doc-actions">
            {secondaryAction}
            {primaryAction}
          </div>
        )}
      </div>
    </article>
  );
}

export function PreviewButton({ onClick }: { onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="oa-doc-action">
      <Eye size={16} aria-hidden="true" />
      Preview
    </button>
  );
}

export function DownloadButton({ onClick }: { onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="oa-doc-action">
      <Download size={16} aria-hidden="true" />
      Download
    </button>
  );
}
