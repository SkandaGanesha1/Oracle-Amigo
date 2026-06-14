import { FileText, ShieldAlert, ShieldCheck, Clock3 } from "lucide-react";
import { safeExternalHref, safeMediaSrc } from "../../lib/safeUrl";

interface SafeMediaPreviewProps {
  url?: string | null;
  mimeType?: string | null;
  label?: string | null;
  scanState?: "pending" | "clean" | "blocked" | "unknown";
  safetyState?: "safe" | "blocked" | "unknown";
  sizeBytes?: number | null;
}

function formatSize(sizeBytes?: number | null): string | null {
  if (!sizeBytes || !Number.isFinite(sizeBytes)) return null;
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SafeMediaPreview({ url, mimeType, label, scanState = "unknown", safetyState = "unknown", sizeBytes }: SafeMediaPreviewProps) {
  const safeSrc = safeMediaSrc(url);
  const safeHref = safeExternalHref(url);
  const type = (mimeType ?? "").toLowerCase();
  const name = label?.trim() || "Attachment";
  const size = formatSize(sizeBytes);

  if (scanState === "pending") {
    return (
      <div className="inline-flex min-h-[40px] max-w-full items-center gap-2 rounded-lg border border-oa-border bg-oa-surface/70 px-3 py-2 text-xs text-oa-text-muted">
        <Clock3 className="h-4 w-4 text-oa-amber" aria-hidden="true" />
        <span className="truncate">Scanning attachment...</span>
      </div>
    );
  }

  if (scanState === "blocked" || safetyState === "blocked") {
    return (
      <div className="inline-flex min-h-[40px] max-w-full items-center gap-2 rounded-lg border border-oa-red/30 bg-oa-red/10 px-3 py-2 text-xs text-oa-red">
        <ShieldAlert className="h-4 w-4" aria-hidden="true" />
        <span className="truncate">{name} blocked by safety scan</span>
      </div>
    );
  }

  if (!safeSrc && !safeHref) return null;

  if (safeSrc && type.startsWith("image/")) {
    return (
      <img
        src={safeSrc}
        alt={name}
        loading="lazy"
        className="max-h-64 max-w-full rounded-lg border border-oa-border object-contain"
      />
    );
  }

  if (safeSrc && type.startsWith("video/")) {
    return (
      <video
        src={safeSrc}
        controls
        preload="metadata"
        muted
        className="max-h-64 max-w-full rounded-lg border border-oa-border"
      />
    );
  }

  if (!safeHref) return null;

  return (
    <a
      href={safeHref}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-[40px] max-w-full items-center gap-2 rounded-lg border border-oa-border bg-oa-surface/70 px-3 py-2 text-xs text-oa-text-secondary transition-colors hover:border-oa-border-strong hover:text-oa-text"
    >
      <FileText className="h-4 w-4 text-oa-text-muted" aria-hidden="true" />
      <span className="truncate">{name}</span>
      {size && <span className="shrink-0 text-oa-text-disabled">{size}</span>}
      {scanState === "clean" && <ShieldCheck className="h-3.5 w-3.5 text-oa-green" aria-label="Attachment scan clean" />}
    </a>
  );
}
