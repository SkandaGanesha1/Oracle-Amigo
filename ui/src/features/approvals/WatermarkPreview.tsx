import { ShieldCheck } from "lucide-react";

interface WatermarkPreviewProps {
  recipientDisplayName: string;
  text?: string;
}

export function WatermarkPreview({ recipientDisplayName, text }: WatermarkPreviewProps) {
  const watermark = text?.trim() || `Sent to ${recipientDisplayName} by Oracle Amigo on ${new Date().toISOString()}`;

  return (
    <div className="rounded-lg border border-oa-border bg-oa-bg-elevated p-3">
      <div className="mb-2 flex items-center gap-2">
        <ShieldCheck className="h-3.5 w-3.5 text-oa-green" />
        <p className="text-[10px] font-semibold uppercase tracking-wider text-oa-text-muted">Watermark</p>
      </div>
      <div className="rounded border border-dashed border-oa-border bg-oa-bg p-3">
        <p className="-rotate-3 text-center text-[10px] font-medium text-oa-text-muted opacity-80">{watermark}</p>
      </div>
    </div>
  );
}
