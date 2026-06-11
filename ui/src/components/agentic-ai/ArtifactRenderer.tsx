import { Download, ExternalLink, FileText, ShieldCheck } from "lucide-react";
import type { AgentRunResult } from "../../api/types";

interface ArtifactRendererProps {
  run: AgentRunResult | null | undefined;
  compact?: boolean;
}

export function ArtifactRenderer({ run, compact = false }: ArtifactRendererProps) {
  if (!run?.finalAnswer && (!run?.steps || run.steps.length === 0)) {
    return (
      <div className="rounded-xl border border-oa-border bg-oa-surface/70 p-4 text-sm text-oa-text-muted">
        No run artifacts available.
      </div>
    );
  }

  const selectedFileId = run.finalAnswer?.selectedFileId;

  return (
    <section className="rounded-xl border border-oa-border bg-oa-surface/80 p-4">
      <div className="mb-3 flex items-center gap-2">
        <FileText className="h-4 w-4 text-oa-blue" />
        <h3 className="text-sm font-semibold text-oa-text">Run Artifact</h3>
        <span className="ml-auto rounded-full bg-oa-surface-2 px-2 py-0.5 text-[10px] text-oa-text-muted">
          {run.status}
        </span>
      </div>

      {run.finalAnswer && (
        <div className="rounded-lg border border-oa-border/60 bg-oa-bg-elevated p-3">
          <div className="mb-1 flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-oa-green" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-oa-text-muted">
              Final answer
            </span>
          </div>
          <p className={compact ? "text-xs text-oa-text-secondary" : "text-sm text-oa-text"}>
            {run.finalAnswer.message}
          </p>
        </div>
      )}

      {selectedFileId && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href={`/storage/files/${encodeURIComponent(selectedFileId)}/open`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-oa-border bg-oa-surface-2 px-3 text-xs text-oa-text-muted hover:text-oa-text"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Preview
          </a>
          <a
            href={`/storage/files/${encodeURIComponent(selectedFileId)}/download`}
            download
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-oa-border bg-oa-surface-2 px-3 text-xs text-oa-text-muted hover:text-oa-text"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </a>
        </div>
      )}
    </section>
  );
}
