import { useMemo, useState } from "react";
import { Droplets, Eye, FileWarning, Stamp } from "lucide-react";
import { useApplyRedaction, useRedactionPreview } from "../../hooks/queries";
import { WatermarkPreview } from "./WatermarkPreview";
import type { CandidateFile } from "../../types";
import { safeExternalHref } from "../../lib/safeUrl";

interface RedactionEditorProps {
  file: CandidateFile | undefined;
  recipientDisplayName: string;
}

function isPdf(file: CandidateFile | undefined): boolean {
  if (!file) return false;
  return /\.pdf$/i.test(file.file_name) || /pdf/i.test(file.mime_type);
}

export function RedactionEditor({ file, recipientDisplayName }: RedactionEditorProps) {
  const preview = useRedactionPreview();
  const apply = useApplyRedaction();
  const [watermarkText, setWatermarkText] = useState("");
  const [reason, setReason] = useState("Sensitive data");

  const defaultWatermark = useMemo(
    () => `Sent to ${recipientDisplayName} by Oracle Amigo on ${new Date().toISOString()}`,
    [recipientDisplayName]
  );
  const effectiveWatermark = watermarkText.trim() || defaultWatermark;
  const supported = isPdf(file);
  const redactedDownloadUrl = safeExternalHref(apply.data?.job?.downloadUrl);

  async function runPreview() {
    if (!file) return;
    await preview.mutateAsync({
      fileId: file.candidate_id,
      recipientLabel: recipientDisplayName,
      watermarkText: effectiveWatermark,
      redactions: [{ page: 1, x: 48, y: 48, width: 220, height: 32, reason }]
    });
  }

  async function applyRedaction() {
    if (!file) return;
    await apply.mutateAsync({
      fileId: file.candidate_id,
      recipientLabel: recipientDisplayName,
      watermarkText: effectiveWatermark,
      redactions: [{ page: 1, x: 48, y: 48, width: 220, height: 32, reason }]
    });
  }

  return (
    <section>
      <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-oa-text-disabled">
        Redaction & Watermark
      </h4>
      <div className="space-y-2 rounded-lg border border-oa-border bg-oa-bg-elevated p-3">
        {!supported ? (
          <div className="flex gap-2 rounded-lg border border-oa-amber/25 bg-oa-amber/10 p-2 text-[10px] text-oa-amber">
            <FileWarning className="h-3.5 w-3.5 shrink-0" />
            Redaction is available for stored PDF artifacts. This file can still be approved through the normal policy path.
          </div>
        ) : (
          <>
            <label className="block">
              <span className="mb-1 block text-[10px] text-oa-text-muted">Watermark text</span>
              <textarea
                value={watermarkText}
                onChange={(event) => setWatermarkText(event.target.value)}
                rows={3}
                placeholder={defaultWatermark}
                className="w-full resize-none rounded-lg border border-oa-border bg-oa-bg p-2 text-[10px] text-oa-text outline-none focus:border-oa-blue"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] text-oa-text-muted">Redaction reason</span>
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="h-9 w-full rounded-lg border border-oa-border bg-oa-bg px-2 text-[10px] text-oa-text outline-none focus:border-oa-blue"
              />
            </label>
            <WatermarkPreview recipientDisplayName={recipientDisplayName} text={effectiveWatermark} />
            {preview.data && (
              <div className="rounded-lg border border-oa-green/25 bg-oa-green/10 p-2 text-[10px] text-oa-green">
                Preview ready: {preview.data.pageCount} pages, {preview.data.redactionCount} redaction mark.
              </div>
            )}
            {redactedDownloadUrl && (
              <a
                href={redactedDownloadUrl}
                className="flex min-h-[36px] items-center justify-center gap-2 rounded-lg border border-oa-green/30 bg-oa-green/10 px-3 text-[10px] font-medium text-oa-green"
              >
                <Stamp className="h-3.5 w-3.5" />
                Download redacted artifact
              </a>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void runPreview()}
                disabled={!file || preview.isPending}
                className="flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg border border-oa-border bg-oa-surface-2 px-2 text-[10px] text-oa-text-muted disabled:opacity-50"
              >
                <Eye className="h-3.5 w-3.5" />
                Preview
              </button>
              <button
                type="button"
                onClick={() => void applyRedaction()}
                disabled={!file || apply.isPending}
                className="flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg bg-oa-blue px-2 text-[10px] font-medium text-white disabled:opacity-50"
              >
                <Droplets className="h-3.5 w-3.5" />
                Redact copy
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
