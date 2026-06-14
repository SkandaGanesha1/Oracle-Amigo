import { FileText } from "lucide-react";
import { safeExternalHref, safeMediaSrc } from "../../lib/safeUrl";

interface SafeMediaPreviewProps {
  url?: string | null;
  mimeType?: string | null;
  label?: string | null;
}

export function SafeMediaPreview({ url, mimeType, label }: SafeMediaPreviewProps) {
  const safeSrc = safeMediaSrc(url);
  const safeHref = safeExternalHref(url);
  const type = (mimeType ?? "").toLowerCase();
  const name = label?.trim() || "Attachment";

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
    </a>
  );
}
