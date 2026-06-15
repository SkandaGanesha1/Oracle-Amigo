import { CheckCircle2, Download, Eye, File, FileText, Lock, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

export interface ChatDocumentPreview {
  id: string;
  name: string;
  mimeType: string;
  sizeLabel?: string;
  sha256?: string;
  thumbnailUrl?: string | null;
  previewText?: string | null;
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
  return status ? status.replace(/_/g, " ") : "";
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
  return (
    <article className="oa-doc-card" aria-label={`Document preview: ${file.name}`}>
      <div className="oa-doc-thumb" aria-hidden="true">
        {file.thumbnailUrl ? (
          <img src={file.thumbnailUrl} alt="" loading="lazy" />
        ) : (
          <FileIcon mimeType={file.mimeType} />
        )}
      </div>

      <div className="oa-doc-body">
        <div className="oa-doc-title-row">
          <h4 className="oa-doc-title" title={file.name}>{file.name}</h4>
          {file.verified && (
            <span className="oa-doc-chip success">
              <ShieldCheck size={12} aria-hidden="true" />
              Verified
            </span>
          )}
        </div>

        <div className="oa-doc-meta">
          {file.sizeLabel && <span>{file.sizeLabel}</span>}
          {file.mimeType && <span>{file.mimeType}</span>}
          {file.sha256 && <span>SHA-256 {file.sha256.slice(0, 10)}...</span>}
        </div>

        {file.previewText && (
          <pre className="oa-doc-preview-text">{file.previewText}</pre>
        )}

        <div className="oa-doc-chip-row">
          {file.sensitivity && <span className="oa-doc-chip">Sensitivity: {file.sensitivity}</span>}
          {file.leavesDevice && (
            <span className="oa-doc-chip warning">
              <Lock size={12} aria-hidden="true" />
              Leaves device
            </span>
          )}
          {file.status && (
            <span className="oa-doc-chip">
              <CheckCircle2 size={12} aria-hidden="true" />
              {statusLabel(file.status)}
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
